#!/usr/bin/env python3
"""
V40.2 Position Sizing Comparison — before/after
================================================
يقارن:
  1. baseline (position_size_mult = 1.0 for all)
  2. with_position_sizing (high vol = 55% size, normal = 100%)

نفس الفترة، نفس الكون، نفس الصفقات. التركيز على:
  - MaxDD (الهدف: من -34% لـ -20%)
  - Total Return
  - worst losers (UTOP, IDRE)
  - high vol trades reduced
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
TEMP_DIR = GLM_ROOT / 'data' / 'v402_position_sizing_compare'
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
        c.execute('DELETE FROM predictions')
        c.commit()
    except Exception as e:
        print(f"  ⚠ DELETE failed: {e}")
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
    print(f"  env: HIGH_VOL_ATR={env.get('V40_2_HIGH_VOL_ATR_PCT','default')}, "
          f"HIGH_VOL_SIZE={env.get('V40_2_HIGH_VOL_SIZE_MULT','default')}")
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
        entry = r['entry_price'] or 0
        stop = r['stop_loss'] or 0
        stop_pct = ((entry - stop) / entry * 100) if entry > 0 else 0
        trades.append({
            'ticker': r['ticker'],
            'prediction_date': r['prediction_date'],
            'entry_price': entry,
            'stop_pct': stop_pct,
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

    # Equity + MaxDD
    equity = 1.0
    peak = 1.0
    max_dd = 0
    for r in rets:
        equity *= (1 + r / 100)
        peak = max(peak, equity)
        dd = (equity / peak - 1) * 100
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1) * 100

    loser_returns = [t['return_pct'] for t in losers]
    avg_loser = sum(loser_returns) / len(loser_returns) if loser_returns else 0
    worst_loser = min(loser_returns) if loser_returns else 0

    exit_types = Counter(t['exit_type'] for t in trades)

    # Simulate position sizing for analysis (apply 55% to high vol trades)
    # We use the same logic as the position_sizing module
    try:
        sys.path.insert(0, str(GLM_ROOT / 'vps-service'))
        from analyzers.position_sizing import calculate_position_size
        sized_returns = []
        high_vol_count = 0
        high_vol_losers_reduced = 0
        for t in trades:
            # We need ATR — use stop_pct as proxy (stop is usually ~1.5-2x ATR)
            # So ATR ≈ stop_pct / 1.5 (rough estimate for sizing purposes)
            estimated_atr_pct = t['stop_pct'] / 1.5 if t['stop_pct'] > 0 else 0
            estimated_atr = (estimated_atr_pct / 100) * t['entry_price']
            sizing = calculate_position_size(estimated_atr, t['entry_price'])
            sized_ret = t['return_pct'] * sizing['position_size_mult']
            sized_returns.append(sized_ret)
            if sizing['volatility_class'] == 'HIGH':
                high_vol_count += 1
                if t['return_pct'] < 0:
                    high_vol_losers_reduced += 1
        # Recompute MaxDD with sizing
        sized_equity = 1.0
        sized_peak = 1.0
        sized_max_dd = 0
        for r in sized_returns:
            sized_equity *= (1 + r / 100)
            sized_peak = max(sized_peak, sized_equity)
            dd = (sized_equity / sized_peak - 1) * 100
            sized_max_dd = min(sized_max_dd, dd)
        sized_total_ret = (sized_equity - 1) * 100
    except Exception as e:
        high_vol_count = 0
        high_vol_losers_reduced = 0
        sized_max_dd = max_dd
        sized_total_ret = total_ret

    c.close()
    return {
        'label': label,
        'trades': n,
        'wins': len(winners),
        'losses': len(losers),
        'win_rate_pct': round(len(winners) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_loser_pct': round(avg_loser, 2),
        'worst_loser_pct': round(worst_loser, 2),
        'exit_types': dict(exit_types),
        'position_sizing_simulation': {
            'high_vol_count': high_vol_count,
            'high_vol_losers_reduced': high_vol_losers_reduced,
            'sized_max_dd': round(sized_max_dd, 2),
            'sized_total_ret': round(sized_total_ret, 2),
            'max_dd_improvement': round(max_dd - sized_max_dd, 2) if sized_max_dd != max_dd else 0,
            'total_ret_delta': round(sized_total_ret - total_ret, 2),
        },
        'worst_5_losers': [
            {'ticker': t['ticker'], 'return': round(t['return_pct'], 2),
             'stop_pct': round(t['stop_pct'], 2),
             'exit_type': t['exit_type'], 'holding': t['holding_days']}
            for t in sorted(trades, key=lambda x: x['return_pct'])[:5]
        ],
    }


def main():
    print("=" * 110)
    print("V40.2 POSITION SIZING COMPARISON — before/after")
    print(f"الفترة: {START_DATE} → {END_DATE} (6 شهور) | الكون: {MAX_TICKERS} سهم")
    print("=" * 110)

    runs = [
        {
            'label': 'baseline_no_sizing',
            'env': {
                # Position sizing is built into simulate_trade — to disable, set mult to 1.0
                'V40_2_HIGH_VOL_SIZE_MULT': '1.0',  # all trades = 100% size
            },
            'description': 'baseline: position_size = 100% for all trades (no sizing)',
        },
        {
            'label': 'with_position_sizing',
            'env': {
                'V40_2_HIGH_VOL_ATR_PCT': '6.0',      # ATR% ≥ 6% = high vol
                'V40_2_HIGH_VOL_SIZE_MULT': '0.55',   # 55% size for high vol
                'V40_2_NORMAL_VOL_SIZE_MULT': '1.0',  # 100% for normal
                'V40_2_LOW_VOL_SIZE_MULT': '1.0',     # 100% for low vol
            },
            'description': 'with position sizing: high vol = 55% size, normal/low = 100%',
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
    print("FINAL COMPARISON — baseline (no sizing) vs with_position_sizing")
    print(f"Window: {START_DATE} → {END_DATE} (6 شهور، {MAX_TICKERS} tickers)")
    print("=" * 120)
    print(f"{'Run':30s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'AvgLoser':>9s} | {'WorstLoser':>11s}")
    print("-" * 120)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:30s} | ERROR: {m['error'][:60]}")
            continue
        print(f"{label:30s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {m['avg_loser_pct']:>+7.2f}% | {m['worst_loser_pct']:>+9.2f}%")

    # Delta analysis
    if 'baseline_no_sizing' in results and 'with_position_sizing' in results:
        b = results['baseline_no_sizing']
        s = results['with_position_sizing']
        if 'error' not in b and 'error' not in s:
            print("\n" + "=" * 120)
            print("DELTA (with_position_sizing - baseline):")
            print("=" * 120)
            print(f"  Trades:           {b['trades']:>4d} → {s['trades']:>4d}  (Δ={s['trades']-b['trades']:+d})")
            print(f"  Win Rate:         {b['win_rate_pct']:>5.1f}% → {s['win_rate_pct']:>5.1f}%  (Δ={s['win_rate_pct']-b['win_rate_pct']:+.2f}pp)")
            print(f"  Total Return:     {b['total_return_pct']:>+7.2f}% → {s['total_return_pct']:>+7.2f}%  (Δ={s['total_return_pct']-b['total_return_pct']:+.2f}pp)")
            print(f"  Max Drawdown:     {b['max_drawdown_pct']:>+7.2f}% → {s['max_drawdown_pct']:>+7.2f}%  (Δ={s['max_drawdown_pct']-b['max_drawdown_pct']:+.2f}pp)")
            print(f"  Profit Factor:    {b['profit_factor']:>5.2f} → {s['profit_factor']:>5.2f}  (Δ={s['profit_factor']-b['profit_factor']:+.2f})")
            print(f"  Avg Loser:        {b['avg_loser_pct']:>+7.2f}% → {s['avg_loser_pct']:>+7.2f}%  (Δ={s['avg_loser_pct']-b['avg_loser_pct']:+.2f}pp)")
            print(f"  Worst Loser:      {b['worst_loser_pct']:>+7.2f}% → {s['worst_loser_pct']:>+7.2f}%  (Δ={s['worst_loser_pct']-b['worst_loser_pct']:+.2f}pp)")

    # Position sizing simulation
    print("\n" + "=" * 120)
    print("POSITION SIZING SIMULATION (what would happen with sizing applied):")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        ps = m.get('position_sizing_simulation', {})
        print(f"\n  {label}:")
        print(f"    High vol trades detected: {ps.get('high_vol_count', 0)}")
        print(f"    High vol losers reduced: {ps.get('high_vol_losers_reduced', 0)}")
        print(f"    Sized MaxDD: {ps.get('sized_max_dd', 0):+.2f}% (vs original {m['max_drawdown_pct']:+.2f}%)")
        print(f"    Sized Total Return: {ps.get('sized_total_ret', 0):+.2f}% (vs original {m['total_return_pct']:+.2f}%)")
        print(f"    MaxDD improvement: {ps.get('max_dd_improvement', 0):+.2f}pp")

    # Worst 5 losers per run
    print("\n" + "=" * 120)
    print("WORST 5 LOSERS per run:")
    print("=" * 120)
    for label, m in results.items():
        if 'error' in m:
            continue
        print(f"\n  {label}:")
        for l in m.get('worst_5_losers', []):
            print(f"    {l['ticker']:6s} | {l['return']:+6.2f}% | stop={l['stop_pct']:+.2f}% | {l['exit_type']:15s} | {l['holding']}d")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 POSITION SIZING COMPARISON',
            'window': f'{START_DATE} → {END_DATE}',
            'universe': f'{MAX_TICKERS} EGX tickers',
            'goal': 'هل Position Sizing بيقلل MaxDD من -34% لـ -20%؟',
            'owner_directive': 'السهم العالي التقلب ياخد حجم أصغر',
        },
        'results': results,
        'timestamp': datetime.now().isoformat(),
    }
    out = RESULTS_DIR / 'v402_position_sizing_comparison.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Results saved → {out}")


if __name__ == '__main__':
    main()
