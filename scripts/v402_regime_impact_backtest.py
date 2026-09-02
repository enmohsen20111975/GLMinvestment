#!/usr/bin/env python3
"""
V40.2 REGIME FILTER IMPACT BACKTEST
====================================
يقيس أثر دمج regime_filter على V40.2 الإنتاجي:
  - Baseline: V40.2 بدون regime filter (الإعداد الحالي)
  - Regime_A: V40.2 + V40_2_REGIME_FILTER=1 + mode=A (Close>SMA50)
  - Regime_B: V40.2 + V40_2_REGIME_FILTER=1 + mode=B (Close>SMA20 AND SMA50)

نفس البيانات، نفس الفترة، نفس الكون. المقارنة:
  - عدد الصفقات (هل قلّت؟)
  - Win Rate (هل تحسّن؟)
  - Profit Factor (هل ارتفع؟)
  - Max Drawdown (هل قلّ؟)
  - العائد الإجمالي

الفترة: 2026-02-01 → 2026-08-14 (6 شهور — نفس فترة V40.2 baseline الموثقة)
الكون: 50 سهم EGX (للأداء)
"""
from __future__ import annotations
import sys, os, json, time, subprocess, sqlite3, shutil
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path('/home/z/my-project')
V40_2_SCRIPT = PROJECT_ROOT / 'vps-service' / 'jobs' / 'v40_2_daily_generator.py'
PREDICTIONS_DB = PROJECT_ROOT / 'db' / 'predictions.db'
TEMP_DIR = PROJECT_ROOT / 'data' / 'v402_regime_temp'
RESULTS_DIR = PROJECT_ROOT / 'data' / 'merge_backtest_real'
RESULTS_DIR.mkdir(parents=True, exist_ok=True)
TEMP_DIR.mkdir(parents=True, exist_ok=True)

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = '50'
PYTHON = sys.executable

# Run configurations: baseline vs regime_A vs regime_B
RUNS = [
    {
        'label': 'baseline_no_regime',
        'env': {
            'V40_2_REGIME_FILTER': '0',
            'V40_2_STRICT_ENTRY': '0',
            'V40_2_DISCLOSURE_IMPACT': '0',
            'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
        'description': 'V40.2 baseline (no regime filter, no strict entry) — same as documented V40.2',
    },
    {
        'label': 'regime_filter_A',
        'env': {
            'V40_2_REGIME_FILTER': '1',
            'V40_2_REGIME_MODE': 'A',
            'V40_2_STRICT_ENTRY': '0',
            'V40_2_DISCLOSURE_IMPACT': '0',
            'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
        'description': 'V40.2 + regime filter mode A (Close > SMA50) only — isolate regime impact',
    },
    {
        'label': 'regime_filter_B',
        'env': {
            'V40_2_REGIME_FILTER': '1',
            'V40_2_REGIME_MODE': 'B',
            'V40_2_STRICT_ENTRY': '0',
            'V40_2_DISCLOSURE_IMPACT': '0',
            'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_BACKTEST_MODE': '1',
            'V40_2_SKIP_NEWS': '1',
            'BYPASS_PRED_CAP': '1',
        },
        'description': 'V40.2 + regime filter mode B (Close > SMA20 AND SMA50) only — strictest regime',
    },
]


def run_v40_2(label: str, env_overrides: dict) -> dict:
    """Run V40.2 with specific env + temp DB."""
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
                 'V40_2_SHORT_HOLDING', 'V40_2_DISTRIBUTION_EXIT', 'V40_2_NEWS_IMPACT',
                 'V40_2_REGIME_FILTER']:
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
        '--max-tickers', MAX_TICKERS,
    ]

    print(f"\n[{label}] Running V40.2 backtest (max-tickers={MAX_TICKERS})...")
    t0 = time.time()
    proc = subprocess.run(cmd, env=env, capture_output=True, text=True, timeout=300)
    dt = time.time() - t0

    if proc.returncode != 0:
        print(f"  ❌ FAILED in {dt:.1f}s")
        print(f"  stderr (last 30 lines):")
        for line in proc.stderr.split('\n')[-30:]:
            print(f"    {line}")
        return {'label': label, 'error': proc.stderr[-500:], 'runtime_sec': dt}

    # Extract metrics from the predictions DB
    metrics = extract_metrics(temp_db, label)
    metrics['runtime_sec'] = round(dt, 1)
    print(f"  ✓ Done in {dt:.1f}s — trades={metrics.get('trades', 0)}")
    return metrics


def extract_metrics(db_path: Path, label: str) -> dict:
    """Extract backtest metrics from predictions DB."""
    if not db_path.exists():
        return {'label': label, 'trades': 0, 'error': 'DB not found'}

    conn = sqlite3.connect(str(db_path))
    try:
        rows = conn.execute('''
            SELECT ticker, entry_price, target_price, stop_loss,
                   actual_return, exit_type, is_correct,
                   prediction_date, outcome_date,
                   highest_price_reached, lowest_price_reached
            FROM predictions
            WHERE prediction_date BETWEEN ? AND ?
            ORDER BY prediction_date
        ''', (START_DATE, END_DATE)).fetchall()
    except Exception as e:
        conn.close()
        return {'label': label, 'error': f'DB query: {e}'}

    if not rows:
        conn.close()
        return {'label': label, 'trades': 0,
                'win_rate_pct': 0, 'avg_return_pct': 0, 'total_return_pct': 0,
                'max_drawdown_pct': 0, 'profit_factor': 0, 'avg_holding_days': 0}

    trades = []
    for r in rows:
        ticker, entry, target, stop, ret, exit_type, is_correct, pred_date, out_date, hi, lo = r
        if entry is None or entry <= 0:
            continue
        ret_pct = float(ret) if ret is not None else 0.0
        # Holding days
        holding = 0
        try:
            if pred_date and out_date:
                from datetime import datetime as dt_cls
                p = dt_cls.fromisoformat(pred_date.replace('Z','').split('T')[0])
                o = dt_cls.fromisoformat(out_date.replace('Z','').split('T')[0])
                holding = (o - p).days
        except Exception:
            pass
        trades.append({
            'ticker': ticker, 'return_pct': ret_pct, 'exit_type': exit_type or 'unknown',
            'is_correct': is_correct, 'holding_days': max(holding, 0),
            'entry_price': float(entry) if entry else 0,
        })

    n = len(trades)
    rets = [t['return_pct'] for t in trades]
    wins = [r for r in rets if r > 0]
    losses = [r for r in rets if r <= 0]
    gross_win = sum(wins) if wins else 0.0
    gross_loss = abs(sum(losses)) if losses else 0.0
    pf = (gross_win / gross_loss) if gross_loss > 0 else (float('inf') if gross_win > 0 else 0.0)

    # equity curve
    equity = 1.0
    peak = 1.0
    max_dd = 0.0
    for r in rets:
        equity *= (1.0 + r / 100.0)
        peak = max(peak, equity)
        dd = (equity / peak - 1.0) * 100.0
        max_dd = min(max_dd, dd)
    total_ret = (equity - 1.0) * 100.0

    conn.close()
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
        'exit_types': dict((et, sum(1 for t in trades if t['exit_type'] == et))
                            for et in set(t['exit_type'] for t in trades)),
    }


def main():
    print("=" * 80)
    print("V40.2 REGIME FILTER IMPACT — does regime filter improve V40.2?")
    print("=" * 80)

    results = {}
    for run in RUNS:
        m = run_v40_2(run['label'], run['env'])
        m['description'] = run['description']
        results[run['label']] = m

    # Comparison table
    print("\n" + "=" * 100)
    print("COMPARISON — V40.2 baseline vs +regime_A vs +regime_B")
    print("=" * 100)
    print(f"{'Run':30s} | {'Trades':>7s} | {'WR':>6s} | {'AvgRet':>8s} | {'TotalRet':>10s} | {'MaxDD':>9s} | {'PF':>6s} | {'Hold':>6s}")
    print("-" * 100)
    for label, m in results.items():
        if 'error' in m:
            print(f"{label:30s} | ERROR: {m['error'][:80]}")
            continue
        print(f"{label:30s} | {m['trades']:7d} | {m['win_rate_pct']:5.1f}% | {m['avg_return_pct']:+7.3f}% | {m['total_return_pct']:+9.2f}% | {m['max_drawdown_pct']:+8.2f}% | {m['profit_factor']:6.2f} | {m['avg_holding_days']:5.1f}d")

    # Delta vs baseline
    print("\n=== Delta vs baseline ===")
    if 'baseline_no_regime' in results and 'error' not in results['baseline_no_regime']:
        base = results['baseline_no_regime']
        for label in ['regime_filter_A', 'regime_filter_B']:
            if label not in results or 'error' in results[label]:
                continue
            m = results[label]
            d_trades = m['trades'] - base['trades']
            d_wr = m['win_rate_pct'] - base['win_rate_pct']
            d_pf = m['profit_factor'] - base['profit_factor']
            d_dd = m['max_drawdown_pct'] - base['max_drawdown_pct']
            d_ret = m['total_return_pct'] - base['total_return_pct']
            print(f"  {label}: trades={d_trades:+d}, WR={d_wr:+.1f}pp, PF={d_pf:+.2f}, DD={d_dd:+.2f}pp, Ret={d_ret:+.2f}pp")

    # Verdict
    print("\n=== VERDICT ===")
    for label in ['regime_filter_A', 'regime_filter_B']:
        if label not in results or 'error' in results[label]:
            continue
        m = results[label]
        base = results.get('baseline_no_regime', {})
        if 'error' in base:
            continue
        # did it improve?
        better_pf = m['profit_factor'] > base.get('profit_factor', 0)
        better_dd = m['max_drawdown_pct'] > base.get('max_drawdown_pct', -100)
        better_wr = m['win_rate_pct'] > base.get('win_rate_pct', 0)
        if better_pf and better_dd:
            verdict = "🟢 تحسّن واضح (PF↑ + DD↓)"
        elif better_pf or better_dd:
            verdict = "🟡 تحسّن جزئي"
        else:
            verdict = "🔴 تدهور"
        print(f"  {label}: {verdict}")

    payload = {
        "meta": {
            "test": "V40.2 REGIME FILTER IMPACT",
            "data_source": "V40.2 production pipeline (v40_2_daily_generator.py)",
            "universe": f"{MAX_TICKERS} EGX tickers",
            "window": f"{START_DATE} → {END_DATE} (6 months)",
            "goal": "هل دمج regime_filter بيحسّن V40.2؟ (trades/WR/PF/DD)",
            "production_module": "vps-service/analyzers/regime_filter.py (is_bullish_regime)",
            "integration": "vps-service/jobs/v40_2_daily_generator.py (pre-filter before V40_2_STRICT_ENTRY)",
            "feature_flag": "V40_2_REGIME_FILTER (default OFF)",
            "modes": {"A": "Close > SMA50", "B": "Close > SMA20 AND Close > SMA50"},
        },
        "results": results,
    }
    out = RESULTS_DIR / 'v402_regime_impact.json'
    with open(out, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    pub = PROJECT_ROOT / 'public' / 'backtest-results.json'
    with open(pub, 'w', encoding='utf-8') as f:
        json.dump(payload, f, indent=2, ensure_ascii=False, default=str)
    print(f"\nResults -> {out}")
    print(f"Static  -> {pub}")


if __name__ == "__main__":
    main()
