#!/usr/bin/env python3
"""
V40.2 Tightening Comparison — before/after تضييق الستوب + Trailing
====================================================================
يقارن:
  1. baseline (stop_max=9%, trailing_activation=2%)
  2. tightened (stop_max=7%, trailing_activation=5%, breakeven_floor=1.01)

نفس البيانات، نفس الفترة، نفس الكون. التركيز على:
  - MaxDD (الهدف: من -34% لـ -20%)
  - متوسط الخسارة في الـ losers
  - عدد مرات الـ trailing حمى فيها ربح (trailing_save_count)
  - Win Rate + Profit Factor
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3
from pathlib import Path
from datetime import datetime
from collections import defaultdict, Counter

PROJECT_ROOT = Path('/home/z/my-project')
GLM_ROOT = PROJECT_ROOT / 'GLMinvestment'
V40_2_SCRIPT = GLM_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = GLM_ROOT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = GLM_ROOT / 'data' / 'v402_tightening_compare'
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
    print(f"  env: STOP_MAX={env.get('V40_2_STOP_MAX_PCT','default')}, "
          f"TRAIL_GAIN={env.get('V40_2_TRAILING_ACTIVATION_GAIN','default')}, "
          f"TRAIL_FLOOR={env.get('V40_2_TRAILING_BREAKEVEN_FLOOR','default')}")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=900)
    dt = time.time() - t0

    log_path = TEMP_DIR / f'{label}_stdout.log'
    log_path.write_text(proc.stdout, encoding='utf-8')

    for line in proc.stdout.split('\n')[-15:]:
        if any(k in line for k in ['Total predictions', 'Overall win rate', 'Profit Factor',
                                    'Signals found', 'Processed']):
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
                   stop_loss, actual_return, exit_type, is_correct, score
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
            'entry_price': r['entry_price'],
            'target_price': r['target_price'],
            'stop_loss': r['stop_loss'],
            'return_pct': ret,
            'exit_type': r['exit_type'] or 'unknown',
            'is_correct': r['is_correct'],
            'holding_days': max(holding, 0),
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    winners = [t for t in trades if t['return_pct'] > 0]
    losers = [t for t in trades if t['return_pct'] <= 0]
    gross_win = sum(t['return_pct'] for t in winners)
    gross_loss = abs(sum(t['return_pct'] for t in losers))
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0)

    # Stop distances
    stop_distances = []
    for t in trades:
        entry = t['entry_price'] or 0
        stop = t['stop_loss'] or 0
        if entry > 0 and stop > 0:
            stop_dist = (entry - stop) / entry * 100
            stop_distances.append(stop_dist)

    # Trailing saves = trades where exit_type = trailing_stop AND return > 0
    # (الـ trailing حمى ربح بدل ما يرجع السعر)
    trailing_saves = [t for t in trades if t['exit_type'] == 'trailing_stop' and t['return_pct'] > 0]
    trailing_losses = [t for t in trades if t['exit_type'] == 'trailing_stop' and t['return_pct'] <= 0]

    # Loser analysis: متوسط الخسارة + أكبر خسارة
    loser_returns = [t['return_pct'] for t in losers]
    avg_loser = sum(loser_returns) / len(loser_returns) if loser_returns else 0
    worst_loser = min(loser_returns) if loser_returns else 0
    best_loser = max(loser_returns) if loser_returns else 0

    # Equity curve + MaxDD
    equity = 1.0
    peak = 1.0
    max_dd = 0
    dd_duration_max = 0
    dd_duration_current = 0
    for r in rets:
        equity *= (1 + r / 100)
        peak = max(peak, equity)
        dd = (equity / peak - 1) * 100
        if dd < 0:
            dd_duration_current += 1
            dd_duration_max = max(dd_duration_max, dd_duration_current)
        else:
            dd_duration_current = 0
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1) * 100

    exit_types = Counter(t['exit_type'] for t in trades)

    c.close()
    return {
        'label': label,
        'trades': n,
        'wins': len(winners),
        'losses': len(losers),
        'win_rate_pct': round(len(winners) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'avg_winner_pct': round(gross_win / len(winners), 2) if winners else 0,
        'avg_loser_pct': round(avg_loser, 2),
        'worst_loser_pct': round(worst_loser, 2),
        'best_loser_pct': round(best_loser, 2),
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'max_dd_duration_trades': dd_duration_max,
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_holding_days': round(sum(t['holding_days'] for t in trades) / n, 1) if n else 0,
        'exit_types': dict(exit_types),
        'trailing_saves': len(trailing_saves),
        'trailing_save_returns': [round(t['return_pct'], 2) for t in trailing_saves],
        'trailing_losses': len(trailing_losses),
        'stop_distance': {
            'avg': round(sum(stop_distances) / len(stop_distances), 2) if stop_distances else 0,
            'min': round(min(stop_distances), 2) if stop_distances else 0,
            'max': round(max(stop_distances), 2) if stop_distances else 0,
        },
        'worst_5_losers': [
            {'ticker': t['ticker'], 'return': round(t['return_pct'], 2),
             'exit_type': t['exit_type'], 'holding': t['holding_days']}
            for t in sorted(trades, key=lambda x: x['return_pct'])[:5]
        ],
        'best_5_winners': [
            {'ticker': t['ticker'], 'return': round(t['return_pct'], 2),
             'exit_type': t['exit_type'], 'holding': t['holding_days']}
            for t in sorted(trades, key=lambda x: -x['return_pct'])[:5]
        ],
    }


def main():
    print("=" * 110)
    print("V40.2 TIGHTENING COMPARISON — stop 9%→7% + trailing +5% + breakeven floor")
    print(f"الفترة: {START_DATE} → {END_DATE} (6 شهور) | الكون: {MAX_TICKERS} سهم")
    print("=" * 110)

    runs = [
        {
            'label': 'baseline_stop9_trail2',
            'env': {
                'V40_2_STOP_MAX_PCT': '9.0',
                'V40_2_TRAILING_ACTIVATION_GAIN': '2.0',
                'V40_2_TRAILING_BREAKEVEN_FLOOR': '1.0',
            },
            'description': 'baseline: stop_max=9%, trailing_activation=+2%, no breakeven floor',
        },
        {
            'label': 'tightened_stop7_trail5',
            'env': {
                'V40_2_STOP_MAX_PCT': '7.0',
                'V40_2_TRAILING_ACTIVATION_GAIN': '5.0',
                'V40_2_TRAILING_BREAKEVEN_FLOOR': '1.01',
            },
            'description': 'tightened: stop_max=7%, trailing_activation=+5%, breakeven floor=+1%',
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
    print("FINAL COMPARISON — baseline (stop9/trail2) vs tightened (stop7/trail5)")
    print(f"Window: {START_DATE} → {END_DATE} (6 شهور، {MAX_TICKERS} tickers)")
    print("=" * 120)
    print(f"{'Run':35s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'AvgLoser':>9s} | {'WorstLoser':>11s} | {'TrailSaves':>11s}")
    print("-" * 120)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:35s} | ERROR: {m['error'][:60]}")
            continue
        print(f"{label:35s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {m['avg_loser_pct']:>+7.2f}% | {m['worst_loser_pct']:>+9.2f}% | {m['trailing_saves']:>11d}")

    # Delta analysis
    if 'baseline_stop9_trail2' in results and 'tightened_stop7_trail5' in results:
        b = results['baseline_stop9_trail2']
        t = results['tightened_stop7_trail5']
        if 'error' not in b and 'error' not in t:
            print("\n" + "=" * 120)
            print("DELTA (tightened - baseline):")
            print("=" * 120)
            print(f"  Trades:           {b['trades']:>4d} → {t['trades']:>4d}  (Δ={t['trades']-b['trades']:+d})")
            print(f"  Win Rate:        {b['win_rate_pct']:>5.1f}% → {t['win_rate_pct']:>5.1f}%  (Δ={t['win_rate_pct']-b['win_rate_pct']:+.2f}pp)")
            print(f"  Total Return:    {b['total_return_pct']:>+7.2f}% → {t['total_return_pct']:>+7.2f}%  (Δ={t['total_return_pct']-b['total_return_pct']:+.2f}pp)")
            print(f"  Max Drawdown:    {b['max_drawdown_pct']:>+7.2f}% → {t['max_drawdown_pct']:>+7.2f}%  (Δ={t['max_drawdown_pct']-b['max_drawdown_pct']:+.2f}pp)")
            print(f"  Profit Factor:    {b['profit_factor']:>5.2f} → {t['profit_factor']:>5.2f}  (Δ={t['profit_factor']-b['profit_factor']:+.2f})")
            print(f"  Avg Loser:       {b['avg_loser_pct']:>+7.2f}% → {t['avg_loser_pct']:>+7.2f}%  (Δ={t['avg_loser_pct']-b['avg_loser_pct']:+.2f}pp)")
            print(f"  Worst Loser:     {b['worst_loser_pct']:>+7.2f}% → {t['worst_loser_pct']:>+7.2f}%  (Δ={t['worst_loser_pct']-b['worst_loser_pct']:+.2f}pp)")
            print(f"  Trailing Saves:  {b['trailing_saves']:>4d} → {t['trailing_saves']:>4d}  (Δ={t['trailing_saves']-b['trailing_saves']:+d})")
            print(f"  Stop Distance:   {b['stop_distance']['avg']:>+5.2f}% → {t['stop_distance']['avg']:>+5.2f}%  (Δ={t['stop_distance']['avg']-b['stop_distance']['avg']:+.2f}pp)")

    # Exit types
    print("\n" + "=" * 120)
    print("EXIT TYPES per run:")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        print(f"\n  {label}:")
        for et, cnt in sorted(m.get('exit_types', {}).items(), key=lambda x: -x[1]):
            print(f"    {et:25s}: {cnt}")

    # Worst 5 losers per run
    print("\n" + "=" * 120)
    print("WORST 5 LOSERS per run:")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        print(f"\n  {label}:")
        for l in m.get('worst_5_losers', []):
            print(f"    {l['ticker']:6s} | {l['return']:+6.2f}% | {l['exit_type']:15s} | {l['holding']}d")

    # Best 5 winners per run
    print("\n" + "=" * 120)
    print("BEST 5 WINNERS per run:")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        print(f"\n  {label}:")
        for w in m.get('best_5_winners', []):
            print(f"    {w['ticker']:6s} | +{w['return']:5.2f}% | {w['exit_type']:15s} | {w['holding']}d")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 TIGHTENING COMPARISON',
            'window': f'{START_DATE} → {END_DATE}',
            'universe': f'{MAX_TICKERS} EGX tickers',
            'goal': 'هل تضييق الستوب +5% + trailing +5% + breakeven floor بيوصل MaxDD لـ -20%؟',
            'owner_directive': 'خفّض الستوب الأقصى من 9% لـ 7% + فعّل Trailing Stop بعد +5% ربح',
        },
        'results': results,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_tightening_comparison.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved → {out}")


if __name__ == '__main__':
    main()
