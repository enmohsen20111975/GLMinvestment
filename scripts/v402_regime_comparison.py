#!/usr/bin/env python3
"""
V40.2 Regime Filter Comparison — مقارنة baseline vs +Regime filter mode B
=========================================================================
توجيه المالك: "أقوى حل حاليًا: تفعيل فلتر الـ Regime (Close > SMA50 أو النسخة B)
كـ pre-filter. ده هنقص الصفقات الضعيفة اللي بتحصل في الاتجاه الهابط، واللي
هي السبب الرئيسي في السحوبات الكبيرة."

يقارن:
  1. baseline (بدون regime filter)
  2. + Regime filter mode A (Close > SMA50)
  3. + Regime filter mode B (Close > SMA20 AND Close > SMA50)

نفس البيانات، نفس الفترة، نفس الكون. الهدف: هل Regime filter بيقلل MaxDD؟
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict, Counter

PROJECT_ROOT = Path('/home/z/my-project')
GLM_ROOT = PROJECT_ROOT / 'GLMinvestment'
V40_2_SCRIPT = GLM_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = GLM_ROOT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = GLM_ROOT / 'data' / 'v402_regime_compare'
RESULTS_DIR = GLM_ROOT / 'data' / 'merge_backtest_real'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = '235'
PYTHON = sys.executable


def setup_temp_db(label: str) -> Path:
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()
    src = sqlite3.connect(str(PREDICTIONS_DB))
    dst = sqlite3.connect(str(temp_db))
    src.backup(dst)
    dst.close()
    src.close()
    temp_db.chmod(0o644)
    c = sqlite3.connect(str(temp_db))
    try:
        # DEV-06 (2026-10-12 — DUAL-TRACK): Hard DELETE disabled per Rule 21/35.
        # Replace with UPDATE status='ARCHIVED' + archive reason in notes.
        c.execute(
            "UPDATE predictions SET status='ARCHIVED', "
            "notes=COALESCE(notes,'') || ' | DEV-06-ARCHIVED' WHERE 1=1"
        )
        c.commit()
    except Exception as e:
        print(f"  ⚠ UPDATE failed: {e}")
    c.close()
    return temp_db


def run_v40_2(label: str, env_overrides: dict) -> Path:
    temp_db = setup_temp_db(label)

    env = os.environ.copy()
    for f in ['V40_2_REGIME_FILTER', 'V40_2_REGIME_MODE', 'V40_2_STRICT_ENTRY',
              'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT', 'V40_2_NEWS_IMPACT',
              'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT', 'V40_2_EXPERT_RECS']:
        env[f] = '0'
    env.update({
        'V40_2_BACKTEST_MODE': '1',
        'V40_2_SKIP_NEWS': '1',
        'BYPASS_PRED_CAP': '1',
        'V40_2_PREDICTIONS_DB': str(temp_db),
        'DATA_ENGINE_DB': str(GLM_ROOT / 'db' / 'data_engine.db'),
        'PYTHONPATH': str(GLM_ROOT / 'vps-service'),
    })
    env.update(env_overrides)

    cmd = [PYTHON, str(V40_2_SCRIPT),
           '--start', START_DATE, '--end', END_DATE,
           '--scan-interval', '1', '--max-tickers', MAX_TICKERS]

    print(f"\n[{label}] running V40.2 ({START_DATE}→{END_DATE}, {MAX_TICKERS} tickers)...")
    print(f"  env: REGIME_FILTER={env.get('V40_2_REGIME_FILTER')}, REGIME_MODE={env.get('V40_2_REGIME_MODE')}")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900)
    dt = time.time() - t0

    log_path = TEMP_DIR / f'{label}_stdout.log'
    log_path.write_text(proc.stdout, encoding='utf-8')

    # Print key lines
    for line in proc.stdout.split('\n')[-15:]:
        if any(k in line for k in ['Total predictions', 'Overall win rate', 'Profit Factor',
                                    'Signals found', 'Processed', 'REGIME', 'regime']):
            print(f"  {line.strip()}")

    print(f"  ⏱ runtime: {dt:.1f}s")
    return temp_db


def extract_metrics(db_path: Path, label: str) -> dict:
    if not db_path.exists():
        return {'label': label, 'error': 'DB missing'}

    c = sqlite3.connect(str(db_path))
    c.row_factory = sqlite3.Row

    try:
        rows = c.execute('''
            SELECT ticker, prediction_date, outcome_date, entry_price, target_price,
                   stop_loss, actual_return, exit_type, is_correct, score, persona, morning_bell
            FROM predictions
            WHERE prediction_date BETWEEN ? AND ?
            ORDER BY prediction_date
        ''', (START_DATE, END_DATE)).fetchall()
    except Exception as e:
        c.close()
        return {'label': label, 'error': str(e)}

    if not rows:
        c.close()
        return {'label': label, 'trades': 0}

    trades = []
    for r in rows:
        ret = float(r['actual_return']) if r['actual_return'] is not None else 0.0
        holding = 0
        try:
            if r['prediction_date'] and r['outcome_date']:
                p = r['prediction_date'].split('T')[0]
                o = r['outcome_date'].split('T')[0]
                holding = (datetime.fromisoformat(o) - datetime.fromisoformat(p)).days
        except Exception:
            pass
        trades.append({
            'ticker': r['ticker'],
            'prediction_date': r['prediction_date'],
            'return_pct': ret,
            'exit_type': r['exit_type'] or 'unknown',
            'is_correct': r['is_correct'],
            'holding_days': max(holding, 0),
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] <= 0]
    gross_win = sum(t['return_pct'] for t in wins)
    gross_loss = abs(sum(t['return_pct'] for t in losses))
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0)

    equity = 1.0
    peak = 1.0
    max_dd = 0
    for r in rets:
        equity *= (1 + r / 100)
        peak = max(peak, equity)
        dd = (equity / peak - 1) * 100
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1) * 100

    exit_types = Counter(t['exit_type'] for t in trades)

    # Per-month
    per_month = defaultdict(lambda: {'trades': 0, 'wins': 0, 'return': 0})
    for t in trades:
        month = (t['prediction_date'] or '')[:7]
        per_month[month]['trades'] += 1
        if t['return_pct'] > 0:
            per_month[month]['wins'] += 1
        per_month[month]['return'] += t['return_pct']

    c.close()
    return {
        'label': label,
        'trades': n,
        'wins': len(wins),
        'losses': len(losses),
        'win_rate_pct': round(len(wins) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'avg_winner_pct': round(gross_win / len(wins), 2) if wins else 0,
        'avg_loser_pct': round(-gross_loss / len(losses), 2) if losses else 0,
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_holding_days': round(sum(t['holding_days'] for t in trades) / n, 1) if n else 0,
        'exit_types': dict(exit_types),
        'per_month': dict(per_month),
    }


def main():
    print("=" * 110)
    print("V40.2 REGIME FILTER COMPARISON — هل Regime filter بيقلل MaxDD؟")
    print(f"الفترة: {START_DATE} → {END_DATE} (6 شهور) | الكون: {MAX_TICKERS} سهم")
    print("=" * 110)

    runs = [
        {
            'label': 'baseline_no_regime',
            'env': {
                'V40_2_REGIME_FILTER': '0',
            },
            'description': 'V40.2 baseline بدون regime filter',
        },
        {
            'label': 'regime_mode_A',
            'env': {
                'V40_2_REGIME_FILTER': '1',
                'V40_2_REGIME_MODE': 'A',
            },
            'description': 'V40.2 + Regime filter mode A (Close > SMA50)',
        },
        {
            'label': 'regime_mode_B',
            'env': {
                'V40_2_REGIME_FILTER': '1',
                'V40_2_REGIME_MODE': 'B',
            },
            'description': 'V40.2 + Regime filter mode B (Close > SMA20 AND SMA50)',
        },
    ]

    results = {}
    for run in runs:
        print(f"\n{'='*110}")
        print(f"RUN: {run['label']}")
        print(f"  {run['description']}")
        print(f"{'='*110}")
        try:
            temp_db = run_v40_2(run['label'], run['env'])
            m = extract_metrics(temp_db, run['label'])
        except subprocess.TimeoutExpired:
            m = {'label': run['label'], 'error': 'timeout (15 min)'}
        except Exception as e:
            m = {'label': run['label'], 'error': str(e)}
        results[run['label']] = m

    # Comparison
    print("\n" + "=" * 120)
    print("FINAL COMPARISON — V40.2 baseline vs +Regime A vs +Regime B")
    print(f"Window: {START_DATE} → {END_DATE} (6 شهور، {MAX_TICKERS} tickers)")
    print("=" * 120)
    print(f"{'Run':25s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'AvgHold':>7s}")
    print("-" * 120)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:25s} | ERROR: {m['error'][:60]}")
            continue
        print(f"{label:25s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {m['avg_holding_days']:5.1f}d")

    # Exit types comparison
    print("\n" + "=" * 120)
    print("EXIT TYPES per run:")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        print(f"\n  {label}:")
        for et, cnt in sorted(m.get('exit_types', {}).items(), key=lambda x: -x[1]):
            print(f"    {et:25s}: {cnt}")

    # Per-month comparison
    print("\n" + "=" * 120)
    print("PER-MONTH comparison:")
    print("=" * 120)
    months = set()
    for label, m in results.items():
        if 'error' not in m:
            months.update(m.get('per_month', {}).keys())
    for month in sorted(months):
        print(f"\n  {month}:")
        for label, m in results.items():
            if 'error' in m:
                continue
            pm = m.get('per_month', {}).get(month, {})
            if pm:
                wr = (pm['wins'] / pm['trades'] * 100) if pm['trades'] else 0
                print(f"    {label:25s}: {pm['trades']:3d} trades | WR={wr:5.1f}% | return={pm['return']:+7.2f}%")

    # Delta analysis
    if 'baseline_no_regime' in results and 'regime_mode_B' in results:
        b = results['baseline_no_regime']
        r = results['regime_mode_B']
        if 'error' not in b and 'error' not in r:
            print("\n" + "=" * 120)
            print("DELTA (regime_mode_B - baseline):")
            print("=" * 120)
            print(f"  Trades:       {b['trades']:>4d} → {r['trades']:>4d}  (Δ={r['trades']-b['trades']:+d})")
            print(f"  Win Rate:    {b['win_rate_pct']:>5.1f}% → {r['win_rate_pct']:>5.1f}%  (Δ={r['win_rate_pct']-b['win_rate_pct']:+.2f}pp)")
            print(f"  Total Return: {b['total_return_pct']:>+7.2f}% → {r['total_return_pct']:>+7.2f}%  (Δ={r['total_return_pct']-b['total_return_pct']:+.2f}pp)")
            print(f"  Max Drawdown: {b['max_drawdown_pct']:>+7.2f}% → {r['max_drawdown_pct']:>+7.2f}%  (Δ={r['max_drawdown_pct']-b['max_drawdown_pct']:+.2f}pp)")
            print(f"  Profit Factor: {b['profit_factor']:>5.2f} → {r['profit_factor']:>5.2f}  (Δ={r['profit_factor']-b['profit_factor']:+.2f})")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 REGIME FILTER COMPARISON',
            'window': f'{START_DATE} → {END_DATE}',
            'universe': f'{MAX_TICKERS} EGX tickers',
            'goal': 'هل Regime filter (mode A أو B) بيقلل MaxDD من -31% لـ -20%؟',
            'owner_directive': 'أقوى حل حاليًا: تفعيل فلتر الـ Regime كـ pre-filter',
        },
        'results': results,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_regime_comparison.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved → {out}")


if __name__ == '__main__':
    main()
