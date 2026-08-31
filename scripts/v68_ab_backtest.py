#!/usr/bin/env python3
"""
V68 A/B Backtest Harness (v2 — with WR/PF)
============================================
القاعدة: النتائج هي اللي تقرر - بـ نـ keep الكويس ونمسيح الوحش.

المنطق (علمي):
  1. Baseline: V40.2 بدون أي ميزة V68 → temp DB → read WR/PF/Return
  2. Test كل ميزة V68 لوحدها → temp DB → read WR/PF/Return
  3. قارن: trades, WR, PF, total return, avg return
  4. لو الميزة حسّنت (WR↑ or PF↑ or Return↑) → KEEP
  5. لو الميزة وحّشت (WR↓ or PF↓ or Return↓) → KILL

الـ 5 ميزات تحت الاختبار:
  - V68_DIRTY_DIST_REJECT    : hard reject dirty distribution
  - V68_NO_CHASE_2D_REJECT   : hard reject 2-day chase
  - V68_PROOF_PROBABILITY    : add oracle_probability as proof #8
  - V68_APLUS_BOOST          : A+ liquidity grab +10 boost
  - V68_MAGNETIC_TARGET      : high_magnet → target_2

Usage:
  python3 scripts/v68_ab_backtest.py
  python3 scripts/v68_ab_backtest.py --quick    # 50 tickers (fast)
  python3 scripts/v68_ab_backtest.py --feature V68_DIRTY_DIST_REJECT  # single feature
"""
import subprocess
import sys
import os
import re
import json
import time
import sqlite3
import shutil
from pathlib import Path

# ═══════════════════════════════════════════════════════════════════════
# Config
# ═══════════════════════════════════════════════════════════════════════

PROJECT_ROOT = Path(__file__).resolve().parent.parent
V40_2_SCRIPT = PROJECT_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
RESULTS_DIR = PROJECT_ROOT / 'data' / 'v68_ab_results'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DB_DIR = PROJECT_ROOT / 'data' / 'v68_ab_temp'
TEMP_DB_DIR.mkdir(parents=True, exist_ok=True)

# Backtest window (matches the V40.2 baseline backtest)
START_DATE = '2026-02-01'
END_DATE = '2026-08-27'
SCAN_INTERVAL = '3'
MAX_PICKS = '5'

# 5 V68 features under test
V68_FEATURES = [
    ('V68_DIRTY_DIST_REJECT',  'Hard reject: dirty distribution'),
    ('V68_NO_CHASE_2D_REJECT', 'Hard reject: 2-day chase >15%'),
    ('V68_PROOF_PROBABILITY',  'Proof #8: oracle_probability 0-100'),
    ('V68_APLUS_BOOST',        'A+ boost: liquidity_grab +10'),
    ('V68_MAGNETIC_TARGET',    'Magnetic target: high_magnet→t2'),
]

# ═══════════════════════════════════════════════════════════════════════
# Run single backtest with specific env vars (NON dry-run, temp DB)
# ═══════════════════════════════════════════════════════════════════════

def run_backtest(label: str, env_overrides: dict, max_tickers: int = None) -> dict:
    """Run V40.2 (NON dry-run) with temp DB, then read WR/PF from temp DB."""
    # Create temp DB path for this run
    safe_label = re.sub(r'[^A-Za-z0-9_]', '_', label)
    temp_db = TEMP_DB_DIR / f'pred_{safe_label}_{int(time.time())}.db'
    # Remove if exists (fresh start)
    if temp_db.exists():
        temp_db.unlink()

    # Copy schema from real predictions.db (so delete_old_v40_predictions works)
    real_db = PROJECT_ROOT / 'db' / 'predictions.db'
    if real_db.exists():
        import shutil
        shutil.copy(str(real_db), str(temp_db))
        # Clear all data from the copy (keep schema only)
        conn = sqlite3.connect(str(temp_db))
        try:
            conn.execute('DELETE FROM predictions')
            conn.commit()
        except Exception:
            pass
        conn.close()

    env = os.environ.copy()
    # Default: all V68 features OFF (baseline)
    for feat, _ in V68_FEATURES:
        env[feat] = '0'
    # Apply overrides
    env.update(env_overrides)
    # Override predictions DB path
    env['V40_2_PREDICTIONS_DB'] = str(temp_db)
    # Enable backtest mode: writes predictions + outcomes to temp DB
    env['V40_2_BACKTEST_MODE'] = '1'

    cmd = [
        sys.executable, str(V40_2_SCRIPT),
        '--start', START_DATE,
        '--end', END_DATE,
        '--scan-interval', SCAN_INTERVAL,
        '--max-picks', MAX_PICKS,
        '--force',
        '--dry-run',  # dry-run DOES set outcomes via set_verified_outcome
    ]
    if max_tickers:
        cmd.extend(['--max-tickers', str(max_tickers)])

    print(f"\n{'='*70}")
    print(f"🧪 A/B TEST: {label}")
    print(f"   Env: {env_overrides}")
    print(f"   Temp DB: {temp_db.name}")
    print(f"   Max tickers: {max_tickers or 'all'}")
    print(f"{'='*70}", flush=True)

    start_time = time.time()
    try:
        result = subprocess.run(
            cmd, capture_output=True, text=True, timeout=1200,
            env=env, cwd=str(PROJECT_ROOT)
        )
        elapsed = time.time() - start_time
    except subprocess.TimeoutExpired:
        print(f"❌ TIMEOUT after 1200s", flush=True)
        return {'label': label, 'error': 'timeout', 'env': env_overrides}
    except Exception as e:
        print(f"❌ ERROR: {e}", flush=True)
        return {'label': label, 'error': str(e), 'env': env_overrides}

    stdout = result.stdout or ''
    stderr = result.stderr or ''

    # Parse results from temp DB
    metrics = read_metrics_from_db(temp_db, label, env_overrides, elapsed)
    metrics['exit_code'] = result.returncode
    metrics['temp_db'] = str(temp_db)

    # Count V68 triggers from stdout
    v68_triggers = {}
    for line in stdout.split('\n'):
        for tag in ['V68-DIRTY-DIST', 'V68-NO-CHASE-2D', 'V68-A-PLUS', 'V68-MAGNET-TARGET', 'V68-FUTURE-DOWN']:
            if tag in line:
                v68_triggers[tag] = v68_triggers.get(tag, 0) + 1
    metrics['v68_triggers'] = v68_triggers

    print(f"\n📊 {label}: {metrics.get('trades', 0)} trades | "
          f"WR={metrics.get('win_rate', 0):.1f}% | "
          f"PF={metrics.get('profit_factor', 0):.2f} | "
          f"Return={metrics.get('total_return', 0):+.1f}% "
          f"({elapsed:.1f}s)", flush=True)
    if v68_triggers:
        print(f"   V68 triggers: {v68_triggers}", flush=True)

    # Keep temp DB for audit (don't delete)
    return metrics


def read_metrics_from_db(db_path: Path, label: str, env_overrides: dict, elapsed: float) -> dict:
    """Read predictions.db and compute WR, PF, total return."""
    if not db_path.exists():
        return {
            'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
            'error': 'temp DB not created', 'trades': 0
        }

    try:
        conn = sqlite3.connect(str(db_path))
        # Check if predictions table exists
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
        ).fetchall()
        if not tables:
            conn.close()
            return {
                'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                'error': 'predictions table missing', 'trades': 0
            }

        # Read all predictions that have an outcome (actual_return set)
        rows = conn.execute('''
            SELECT ticker, signal, entry_price, target_price, stop_loss,
                   actual_return, is_correct, hit_target, hit_stop,
                   status, prediction_date, exit_price, holding_days,
                   kill_filter_result
            FROM predictions
            WHERE actual_return IS NOT NULL
        ''').fetchall()
        conn.close()

        if not rows:
            return {
                'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
                'trades': 0, 'win_rate': 0, 'profit_factor': 0, 'total_return': 0,
                'avg_return': 0, 'wins': 0, 'losses': 0
            }

        trades = []
        for r in rows:
            ticker, signal, entry, target, stop, ret, is_correct, hit_t, hit_s, status, pdate, exit_p, hold, kfr = r
            ret = float(ret) if ret is not None else 0.0
            trades.append({
                'ticker': ticker, 'signal': signal, 'entry': entry,
                'target': target, 'stop': stop, 'return_pct': ret,
                'is_win': bool(is_correct) if is_correct is not None else (ret > 0),
                'status': status, 'date': pdate,
                'kill_filter': kfr or '',
            })

        n = len(trades)
        wins = [t for t in trades if t['is_win']]
        losses = [t for t in trades if not t['is_win']]
        wr = (len(wins) / n * 100) if n > 0 else 0
        total_return = sum(t['return_pct'] for t in trades)
        avg_return = (total_return / n) if n > 0 else 0

        gross_profit = sum(t['return_pct'] for t in wins)
        gross_loss = abs(sum(t['return_pct'] for t in losses))
        pf = (gross_profit / gross_loss) if gross_loss > 0 else (float('inf') if gross_profit > 0 else 0)

        # Extract V68 stats from kill_filter_result
        v68_prob_values = []
        v68_aplus_count = 0
        v68_quiet_acc_count = 0
        for t in trades:
            kfr = t.get('kill_filter', '')
            m = re.search(r'V68:prob=(\d+)/100', kfr)
            if m:
                v68_prob_values.append(int(m.group(1)))
            if 'A+GRAB' in kfr:
                v68_aplus_count += 1
            if 'QUIET-ACC' in kfr:
                v68_quiet_acc_count += 1

        return {
            'label': label,
            'env': env_overrides,
            'elapsed_sec': round(elapsed, 1),
            'trades': n,
            'wins': len(wins),
            'losses': len(losses),
            'win_rate': round(wr, 1),
            'profit_factor': round(pf, 2) if pf != float('inf') else 99.99,
            'total_return': round(total_return, 2),
            'avg_return': round(avg_return, 2),
            'v68_prob_avg': round(sum(v68_prob_values) / len(v68_prob_values), 1) if v68_prob_values else 0,
            'v68_aplus_count': v68_aplus_count,
            'v68_quiet_acc_count': v68_quiet_acc_count,
            'trades_detail': trades,
        }
    except Exception as e:
        return {
            'label': label, 'env': env_overrides, 'elapsed_sec': round(elapsed, 1),
            'error': f'DB read error: {e}', 'trades': 0
        }


# ═══════════════════════════════════════════════════════════════════════
# Main A/B test
# ═══════════════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description='V68 A/B Backtest Harness (with WR/PF)')
    parser.add_argument('--quick', action='store_true',
                        help='Quick mode: test on 50 tickers only (faster)')
    parser.add_argument('--feature', type=str, default=None,
                        help='Test single feature only (e.g. V68_DIRTY_DIST_REJECT)')
    args = parser.parse_args()

    max_tickers = 200 if args.quick else None
    mode_str = f"QUICK (max {max_tickers} tickers)" if args.quick else "FULL (all tickers)"
    print(f"""
╔══════════════════════════════════════════════════════════════════════╗
║     V68 A/B Backtest Harness v2 — مع WR/PF/Return لكل ميزة          ║
╠══════════════════════════════════════════════════════════════════════╣
║ Period:    {START_DATE} → {END_DATE}                                 ║
║ Scan:      every {SCAN_INTERVAL} days, max {MAX_PICKS} picks/day                       ║
║ Mode:      {mode_str:<54}║
║ Features:  {len(V68_FEATURES)} under test + baseline                                 ║
║ Method:    NON dry-run (temp DB per run, read WR/PF from predictions)║
╚══════════════════════════════════════════════════════════════════════╝
""", flush=True)

    results = []

    # ── Run 1: BASELINE (all V68 features OFF) ──
    baseline_env = {feat: '0' for feat, _ in V68_FEATURES}
    baseline = run_backtest('BASELINE_V68_OFF', baseline_env, max_tickers)
    results.append(baseline)

    # ── Runs 2-6: each V68 feature ON individually ──
    for feat_name, feat_desc in V68_FEATURES:
        if args.feature and feat_name != args.feature:
            continue
        env = {f: '0' for f, _ in V68_FEATURES}
        env[feat_name] = '1'
        label = f'PLUS_{feat_name}'
        result = run_backtest(label, env, max_tickers)
        results.append(result)

    # ── Summary table ──
    print_summary(results)

    # ── Save results ──
    save_results(results, 'ab_v2')


def print_summary(results: list):
    """Print A/B comparison table with WR/PF/Return."""
    print(f"\n{'='*100}")
    print(f"📋 A/B TEST SUMMARY — V68 Features (baseline vs each feature ON)")
    print(f"{'='*100}")
    print(f"{'Label':<30} {'Trades':>7} {'WR%':>6} {'PF':>6} {'Return%':>9} {'Avg%':>7} {'Δ WR':>6} {'Δ Return':>9} {'Verdict':<10}")
    print(f"{'-'*30} {'-'*7} {'-'*6} {'-'*6} {'-'*9} {'-'*7} {'-'*6} {'-'*9} {'-'*10}")

    baseline = results[0] if results else {}
    baseline_wr = baseline.get('win_rate', 0)
    baseline_ret = baseline.get('total_return', 0)

    for r in results:
        if 'error' in r and 'trades' not in r:
            print(f"{r['label']:<30} {'ERR':>7} {'-':>6} {'-':>6} {'-':>9} {'-':>7} {'-':>6} {'-':>9} {r.get('error','')[:10]:<10}")
            continue
        trades = r.get('trades', 0)
        wr = r.get('win_rate', 0)
        pf = r.get('profit_factor', 0)
        ret = r.get('total_return', 0)
        avg = r.get('avg_return', 0)
        d_wr = wr - baseline_wr
        d_ret = ret - baseline_ret
        d_wr_str = f"{d_wr:+.1f}" if d_wr != 0 else "0.0"
        d_ret_str = f"{d_ret:+.1f}" if d_ret != 0 else "0.0"

        # Verdict
        is_baseline = (r['label'] == 'BASELINE_V68_OFF')
        if is_baseline:
            verdict = 'BASELINE'
        elif trades == 0:
            verdict = '⚠️ NO DATA'
        elif d_wr > 1 or d_ret > 2:
            verdict = '✅ KEEP'
        elif d_wr < -2 or d_ret < -3:
            verdict = '❌ KILL'
        else:
            verdict = '⚖️ NEUTRAL'

        print(f"{r['label']:<30} {trades:>7} {wr:>6.1f} {pf:>6.2f} {ret:>+9.1f} {avg:>+7.2f} {d_wr_str:>6} {d_ret_str:>9} {verdict:<10}")

    print(f"{'='*100}")
    print(f"""
📋 الحكم النهائي (النتائج هي اللي تقرر):

  ✅ KEEP   = الميزة حسّنت (WR↑ >1% OR Return↑ >2%)
  ❌ KILL   = الميزة وحّشت (WR↓ >2% OR Return↓ >3%)
  ⚖️ NEUTRAL = الميزة ملهاش تأثير واضح (within noise)
  ⚠️ NO DATA = الميزة مش اتنفّذت (مفيش triggers)

القرار:
  - KEEP → نخلي default = 1 (مفعّل في الإنتاج)
  - KILL → نخلي default = 0 (معطل) + نمسح الكود
  - NEUTRAL → نخلي default = 1 (safe, مفيش ضرر) + نراجع بـ sample أكبر
  - NO DATA → نخلي default = 1 (مش هقدر نحكم بدون triggers)
""")


def save_results(results: list, suffix: str):
    """Save results to JSON file."""
    timestamp = time.strftime('%Y%m%d_%H%M%S')
    path = RESULTS_DIR / f'v68_ab_{suffix}_{timestamp}.json'
    # Strip trades_detail for summary file (keep main metrics only)
    summary = []
    for r in results:
        s = {k: v for k, v in r.items() if k != 'trades_detail'}
        summary.append(s)
    with open(path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved: {path}")

    # Also save full detail
    detail_path = RESULTS_DIR / f'v68_ab_{suffix}_detail_{timestamp}.json'
    with open(detail_path, 'w', encoding='utf-8') as f:
        json.dump(results, f, indent=2, ensure_ascii=False, default=str)
    print(f"💾 Full detail saved: {detail_path}")


if __name__ == '__main__':
    main()
