#!/usr/bin/env python3
"""Phase 0: V38 Baseline + 3-Stage Pipeline comparison."""
import sys, json, time
from pathlib import Path
from datetime import datetime

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from camp.data_loader import load_data
from camp.backtest import run_backtest
from camp.config import TRAIN_START, TRAIN_END, TEST_START, TEST_END

def run_v38_baseline(data):
    """Run V38 engine on same data."""
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history
    
    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()
    
    tickers = list(data.keys())
    pre_cache_price_history(tickers, engine)
    
    trades = []
    for ticker in tickers:
        dates_t, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < 50:
            continue
        for i in range(50, len(closes)):
            if dates_t[i] < TRAIN_START or dates_t[i] > TEST_END:
                continue
            try:
                result = engine.analyze_single_day(ticker, dates_t, opens, highs, lows, closes, volumes, i)
                signal = result.get('signal', 'WAIT')
                if signal not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    continue
                entry = result.get('entry_price', closes[i])
                target = result.get('target_price') or entry * 1.10
                stop = result.get('stop_loss') or entry * 0.93
                # Find exit
                exit_price = None
                outcome = 'EXPIRED'
                for j in range(i+1, min(i+31, len(closes))):
                    if lows[j] is not None and lows[j] <= stop:
                        exit_price = stop; outcome = 'STOPPED'; break
                    if highs[j] is not None and highs[j] >= target:
                        exit_price = target; outcome = 'TARGET_HIT'; break
                if exit_price is None:
                    exit_price = closes[min(i+30, len(closes)-1)]
                return_pct = (exit_price/entry - 1) * 100
                trades.append({
                    'date': dates_t[i], 'ticker': ticker,
                    'entry': entry, 'exit': exit_price,
                    'return_pct': round(return_pct, 2),
                    'outcome': outcome,
                })
            except:
                pass
    from camp.metrics import calc_metrics
    return trades, calc_metrics(trades)


def main():
    print(f"\n{'='*70}")
    print(f"  Phase 0: Baseline (V38 vs 3-Stage Pipeline)")
    print(f"  Train: {TRAIN_START} → {TRAIN_END}")
    print(f"  Test:  {TEST_START} → {TEST_END}")
    print(f"{'='*70}\n")
    
    print("  Loading data...")
    data = load_data()
    print(f"  Loaded {len(data)} tickers")
    
    # V38 Baseline
    print("\n  Running V38 baseline...")
    t0 = time.time()
    v38_trades, v38_metrics = run_v38_baseline(data)
    print(f"  V38: {len(v38_trades)} signals in {time.time()-t0:.0f}s")
    
    # 3-Stage Pipeline
    print("\n  Running 3-stage pipeline...")
    from camp.pipeline import run_pipeline
    t0 = time.time()
    pipe_trades, pipe_metrics = run_backtest(data, run_pipeline, TRAIN_START, TEST_END)
    print(f"  Pipeline: {len(pipe_trades)} signals in {time.time()-t0:.0f}s")
    
    # Results
    print(f"\n{'='*70}")
    print(f"  📊 PHASE 0 RESULTS")
    print(f"{'='*70}\n")
    print(f"  {'Config':<25} {'Signals':>7} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'AvgRet':>7} {'Sharpe':>7}")
    print(f"  {'─'*70}")
    for name, m in [('V38 Baseline', v38_metrics), ('3-Stage Pipeline', pipe_metrics)]:
        print(f"  {name:<25} {m['signals']:>7} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['avg_ret']:>+6.2f}% {m['sharpe']:>7.2f}")
    
    # Save JSON
    results_dir = Path(__file__).resolve().parents[1] / 'camp' / 'results'
    results_dir.mkdir(parents=True, exist_ok=True)
    output = {
        'timestamp': datetime.now().isoformat(),
        'v38': v38_metrics,
        'pipeline_3stage': pipe_metrics,
    }
    with open(results_dir / 'experiment_000_baseline.json', 'w') as f:
        json.dump(output, f, indent=2, default=str)
    
    # Save markdown
    reports_dir = Path(__file__).resolve().parents[1] / 'camp' / 'reports'
    reports_dir.mkdir(parents=True, exist_ok=True)
    with open(reports_dir / 'PHASE0-BASELINE.md', 'w') as f:
        f.write(f"# Phase 0 — Baseline\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"| Config | Signals | WR | PF | Max DD | Avg Return | Sharpe | Expectancy |\n")
        f.write(f"|--------|---------|-----|-----|--------|------------|--------|------------|\n")
        for name, m in [('V38 Baseline', v38_metrics), ('3-Stage Pipeline', pipe_metrics)]:
            f.write(f"| {name} | {m['signals']} | {m['wr']}% | {m['pf']} | -{m['max_dd']}% | {m['avg_ret']}% | {m['sharpe']} | {m['expectancy']}% |\n")
    
    print(f"\n  💾 Results saved to camp/results/ + camp/reports/")
    print(f"{'='*70}\n")

if __name__ == '__main__':
    main()
