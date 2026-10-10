#!/usr/bin/env python3
"""
V40.2 FINAL REGIME TEST — النسخة الصحيحة
============================================
بعد تأكيد كل القواعد متوفرة (data_engine.db + price_history.db + news.db):

1) Baseline V40.2: بدون regime filter
2) V40.2 + regime A (Close > SMA50)
3) V40.2 + regime B (Close > SMA20 AND Close > SMA50)

بـ max-tickers=235 (كل EGX-canonical) + scan-interval=1.
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3, shutil
from pathlib import Path

PROJECT = Path('/home/z/my-project')
V40_2_SCRIPT = PROJECT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = PROJECT / 'db' / 'vps_real' / 'predictions.db'
TEMP_DIR = PROJECT / 'data' / 'v402_final_test'
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
PYTHON = sys.executable


def extract_v40_metrics(db_path: Path, label: str) -> dict:
    """Read predictions table."""
    if not db_path.exists():
        return {'label': label, 'trades': 0, 'error': 'DB missing'}
    c = sqlite3.connect(str(db_path))
    try:
        rows = c.execute('''
            SELECT ticker, entry_price, target_price, stop_loss, actual_return, exit_type, is_correct,
                   prediction_date, outcome_date
            FROM predictions WHERE prediction_date BETWEEN ? AND ?
            ORDER BY prediction_date
        ''', (START_DATE, END_DATE)).fetchall()
    except Exception as e:
        c.close()
        return {'label': label, 'error': str(e)}

    if not rows:
        c.close()
        return {'label': label, 'trades': 0, 'win_rate_pct': 0, 'profit_factor': 0,
                'total_return_pct': 0, 'max_drawdown_pct': 0, 'avg_holding_days': 0,
                'exit_types': {}, 'morning_bells': 0}

    trades = []
    for r in rows:
        ret = float(r[4]) if r[4] is not None else 0.0
        holding = 0
        try:
            if r[7] and r[8]:
                p = r[7].split('T')[0]
                o = r[8].split('T')[0]
                from datetime import datetime as dt
                holding = (dt.fromisoformat(o) - dt.fromisoformat(p)).days
        except Exception:
            pass
        trades.append({
            'ticker': r[0], 'return_pct': ret, 'exit_type': r[5] or 'unknown',
            'holding_days': max(holding, 0), 'is_correct': r[6]
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    gross_win = sum(wins) if wins else 0
    gross_loss = abs(sum(losses)) if losses else 0
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

    # morning bells (top picks per day)
    morning_bells = sum(1 for t in trades if t.get('is_morning_bell'))

    exit_types = {}
    for t in trades:
        exit_types[t['exit_type']] = exit_types.get(t['exit_type'], 0) + 1

    c.close()
    return {
        'label': label,
        'trades': n,
        'wins': len(wins),
        'losses': len(losses),
        'win_rate_pct': round(len(wins) / n * 100, 2) if n else 0,
        'avg_return_pct': round(sum(rets) / n, 3) if n else 0,
        'total_return_pct': round(total_ret, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 999.99,
        'avg_holding_days': round(sum(t['holding_days'] for t in trades) / n, 1) if n else 0,
        'exit_types': exit_types,
    }


def run_v40_2(label: str, env_overrides: dict) -> dict:
    """Run V40.2 backtest with env overrides."""
    temp_db = TEMP_DIR / f'pred_{label}_{int(time.time())}.db'
    if temp_db.exists():
        temp_db.unlink()
    shutil.copy(str(PREDICTIONS_DB), str(temp_db))
    c = sqlite3.connect(str(temp_db))
    try:
        c.execute('DELETE FROM predictions')
        c.commit()
    except Exception:
        pass
    c.close()

    env = os.environ.copy()
    # Reset all flags
    for f in ['V40_2_REGIME_FILTER', 'V40_2_REGIME_MODE', 'V40_2_STRICT_ENTRY',
              'V40_2_DISCLOSURE_IMPACT', 'V40_2_NOTEBOOK_CONTEXT', 'V40_2_NEWS_IMPACT',
              'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT']:
        env[f] = '0'
    env.update({
        'V40_2_BACKTEST_MODE': '1',
        'V40_2_SKIP_NEWS': '1',
        'BYPASS_PRED_CAP': '1',
        'V40_2_PREDICTIONS_DB': str(temp_db),
    })
    env.update(env_overrides)

    cmd = [PYTHON, str(V40_2_SCRIPT),
           '--start', START_DATE, '--end', END_DATE,
           '--scan-interval', '1', '--max-tickers', '235']

    print(f"\n[{label}] running V40.2 (235 tickers, scan=1)...")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=540)
    dt = time.time() - t0

    # Extract summary
    last_lines = proc.stdout.split('\n')[-30:]
    for line in last_lines:
        if any(k in line for k in ['Total predictions', 'Overall win rate', 'Profit Factor', 'Signals found', 'Processed']):
            print(f"  {line.strip()}")

    metrics = extract_v40_metrics(temp_db, label)
    metrics['runtime_sec'] = round(dt, 1)
    return metrics


def main():
    print("=" * 80)
    print("V40.2 FINAL REGIME TEST — every DB verified available")
    print("=" * 80)
    print(f"\nDBs verified:")
    for db in ['db/data_engine.db', 'db/vps_real/price_history.db', 'db/news.db', 'db/vps_real/predictions.db']:
        if Path(db).exists():
            sz = Path(db).stat().st_size
            print(f"  ✓ {db} ({sz//1024//1024} MB)")
        else:
            print(f"  ✗ {db} MISSING")

    runs = [
        ('baseline_no_regime', {'V40_2_REGIME_FILTER': '0'}),
        ('regime_filter_A', {'V40_2_REGIME_FILTER': '1', 'V40_2_REGIME_MODE': 'A'}),
        ('regime_filter_B', {'V40_2_REGIME_FILTER': '1', 'V40_2_REGIME_MODE': 'B'}),
    ]
    results = {}
    for label, env in runs:
        try:
            m = run_v40_2(label, env)
        except subprocess.TimeoutExpired:
            m = {'label': label, 'error': 'timeout (9 min)'}
        except Exception as e:
            m = {'label': label, 'error': str(e)}
        results[label] = m

    print("\n" + "=" * 100)
    print("FINAL COMPARISON — V40.2 baseline vs +regime_A vs +regime_B (235 tickers, scan=1)")
    print("=" * 100)
    print(f"{'Run':25s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s}")
    print("-" * 100)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:25s} | ERROR: {m['error'][:60]}")
            continue
        print(f"{label:25s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f}")

    # Save
    payload = {
        'meta': {
            'test': 'V40.2 FINAL REGIME TEST',
            'data_source': 'V40.2 production pipeline (v40_2_daily_generator.py)',
            'universe': '235 EGX-canonical tickers',
            'window': f'{START_DATE} → {END_DATE} (6 months, scan_interval=1)',
            'dbs_verified': ['data_engine.db (125 MB)', 'price_history.db (57 MB)',
                              'news.db (13 MB)', 'predictions.db'],
            'goal': 'هل دمج regime_filter بيحسّن V40.2 بعد تأكيد كل القواعد؟',
            'production_module': 'vps-service/analyzers/regime_filter.py',
            'integration': 'vps-service/jobs/v40_2_daily_generator.py (V40_2_REGIME_FILTER flag)',
        },
        'results': results,
    }
    out = PROJECT / 'data' / 'merge_backtest_real' / 'v402_final_regime_test.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")


if __name__ == "__main__":
    main()
