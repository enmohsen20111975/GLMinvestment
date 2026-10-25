#!/usr/bin/env python3
"""
optimize_strategy.py — Grid Search Strategy Optimizer
=======================================================

يختبر 3,125 تركيبة من parameters الاستراتيجية ويرتبهم بالأداء.

الـ parameters اللي بتتغير:
  vol_mult:     [1.0, 1.2, 1.5, 1.8, 2.0]
  momentum_pct: [2, 3, 5, 7, 10]
  target_pct:   [6, 8, 10, 12, 15]
  stop_pct:     [3, 4, 5, 6, 7]
  holding_days: [5, 10, 15, 20, 30]

Train/Test Split:
  TRAIN: 2025-10-01 → 2026-03-31 (6 months, 66+ trading days)
  TEST:  2026-04-01 → 2026-06-10 (2.5 months, ~50 trading days)

Usage:
  python3 scripts/optimize_strategy.py
  python3 scripts/optimize_strategy.py --quick  # subset for fast testing

Author: برافو
"""
from __future__ import annotations

import os
import sys
import json
import math
import argparse
import sqlite3
from datetime import datetime
from pathlib import Path
from itertools import product

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# ─── Parameter Grid ───
PARAM_GRID = {
    'vol_mult':     [1.0, 1.2, 1.5, 1.8, 2.0],
    'momentum_pct': [2, 3, 5, 7, 10],
    'target_pct':   [6, 8, 10, 12, 15],
    'stop_pct':     [3, 4, 5, 6, 7],
    'holding_days': [5, 10, 15, 20, 30],
}

# ─── Acceptance Criteria ───
MIN_TRADES = 30
MIN_PROFIT_FACTOR = 1.3
MIN_WIN_RATE = 35.0

# ─── Train/Test Split ───
TRAIN_START = '2025-10-01'
TRAIN_END = '2026-03-31'
TEST_START = '2026-04-01'
TEST_END = '2026-06-10'


def load_price_data(conn):
    """Load all price data + precompute indicators once."""
    print("  Loading price data + computing indicators...")
    
    # Load all data into memory
    rows = conn.execute("""
        SELECT ticker, date, close_price, high_price, low_price, volume
        FROM price_history
        WHERE date >= '2025-06-01' AND date <= ?
        AND close_price IS NOT NULL AND close_price > 0
        ORDER BY ticker, date
    """, (TEST_END,)).fetchall()
    
    print(f"  Loaded {len(rows):,} rows")
    
    # Group by ticker
    data = {}  # ticker → list of (date, close, high, low, volume)
    for ticker, date, close, high, low, vol in rows:
        if ticker not in data:
            data[ticker] = []
        data[ticker].append((date, close, high, low, vol))
    
    # Compute indicators per ticker
    indicators = {}  # ticker → list of dicts
    for ticker, candles in data.items():
        if len(candles) < 50:
            continue
        
        closes = [c[1] for c in candles]
        volumes = [c[4] for c in candles]
        dates = [c[0] for c in candles]
        highs = [c[2] for c in candles]
        lows = [c[3] for c in candles]
        
        ticker_data = []
        for i in range(len(candles)):
            # MA50
            if i >= 49:
                ma50 = sum(closes[i-49:i+1]) / 50
            else:
                ma50 = None
            
            # Vol MA20
            if i >= 19:
                vol_ma20 = sum(volumes[i-19:i+1]) / 20
            else:
                vol_ma20 = None
            
            # ROC5 (5-day momentum)
            if i >= 5:
                close_5d_ago = closes[i-5]
                roc5 = (closes[i] / close_5d_ago - 1) * 100 if close_5d_ago > 0 else 0
            else:
                roc5 = None
            
            ticker_data.append({
                'date': dates[i],
                'close': closes[i],
                'high': highs[i],
                'low': lows[i],
                'volume': volumes[i],
                'ma50': ma50,
                'vol_ma20': vol_ma20,
                'roc5': roc5,
            })
        
        indicators[ticker] = ticker_data
    
    print(f"  Computed indicators for {len(indicators)} tickers")
    return indicators


def run_backtest(indicators, start_date, end_date, params):
    """Run backtest with given parameters on given date range."""
    vol_mult = params['vol_mult']
    momentum_pct = params['momentum_pct']
    target_pct = params['target_pct']
    stop_pct = params['stop_pct']
    holding_days = params['holding_days']
    
    target_mult = 1 + target_pct / 100
    stop_mult = 1 - stop_pct / 100
    
    trades = []
    
    for ticker, candles in indicators.items():
        for i in range(50, len(candles)):
            day = candles[i]
            if day['date'] < start_date or day['date'] > end_date:
                continue
            
            # Check entry filters
            if day['ma50'] is None or day['vol_ma20'] is None or day['roc5'] is None:
                continue
            if day['close'] <= day['ma50']:
                continue
            if day['vol_ma20'] > 0 and day['volume'] < day['vol_ma20'] * vol_mult:
                continue
            if day['roc5'] < momentum_pct:
                continue
            
            # Entry signal — BUY
            entry_price = day['close']
            target_price = entry_price * target_mult
            stop_price = entry_price * stop_mult
            
            # Find exit
            exit_price = None
            outcome = 'EXPIRED'
            exit_date = None
            
            for j in range(i + 1, min(i + 1 + holding_days, len(candles))):
                future = candles[j]
                
                # Check stop first (conservative)
                if future['low'] <= stop_price:
                    exit_price = stop_price
                    outcome = 'STOPPED'
                    exit_date = future['date']
                    break
                
                # Check target
                if future['high'] >= target_price:
                    exit_price = target_price
                    outcome = 'TARGET_HIT'
                    exit_date = future['date']
                    break
            
            if exit_price is None:
                # Expired — use last available close
                future_idx = min(i + holding_days, len(candles) - 1)
                exit_price = candles[future_idx]['close']
                exit_date = candles[future_idx]['date']
            
            return_pct = (exit_price / entry_price - 1) * 100
            
            trades.append({
                'date': day['date'],
                'ticker': ticker,
                'entry': entry_price,
                'exit': exit_price,
                'outcome': outcome,
                'return_pct': return_pct,
            })
    
    # Calculate metrics
    n_trades = len(trades)
    if n_trades == 0:
        return {'n_trades': 0, 'win_rate': 0, 'profit_factor': 0, 'avg_return': 0}
    
    wins = [t for t in trades if t['outcome'] == 'TARGET_HIT']
    losses = [t for t in trades if t['outcome'] == 'STOPPED']
    
    gross_profit = sum(t['return_pct'] for t in trades if t['return_pct'] > 0)
    gross_loss = abs(sum(t['return_pct'] for t in trades if t['return_pct'] < 0))
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    
    win_rate = len(wins) / n_trades * 100 if n_trades > 0 else 0
    avg_return = sum(t['return_pct'] for t in trades) / n_trades
    
    return {
        'n_trades': n_trades,
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(win_rate, 1),
        'profit_factor': round(pf, 2),
        'avg_return': round(avg_return, 2),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
    }


def score(result):
    """Calculate score: (PF - 1) * (WR/100) * sqrt(N)"""
    if result['n_trades'] == 0 or result['profit_factor'] < 1:
        return 0
    return round((result['profit_factor'] - 1) * (result['win_rate'] / 100) * math.sqrt(result['n_trades']), 2)


def main():
    parser = argparse.ArgumentParser(description='Strategy Optimization — Grid Search')
    parser.add_argument('--quick', action='store_true', help='Quick mode: subset of params')
    args = parser.parse_args()
    
    print(f"\n{'='*70}")
    print(f"  🔬 Strategy Optimization — Grid Search")
    print(f"{'='*70}")
    
    db_path = DB_DIR / 'price_history.db'
    if not db_path.exists():
        print(f"ERROR: {db_path} not found")
        return 1
    
    conn = sqlite3.connect(str(db_path), timeout=30.0)
    
    # Load data once
    indicators = load_price_data(conn)
    conn.close()
    
    # Generate parameter combinations
    if args.quick:
        # Quick mode: 3 values per param = 243 combos
        grid = {
            'vol_mult': [1.0, 1.5, 2.0],
            'momentum_pct': [2, 5, 10],
            'target_pct': [8, 10, 12],
            'stop_pct': [4, 5, 7],
            'holding_days': [10, 20, 30],
        }
    else:
        grid = PARAM_GRID
    
    combos = list(product(
        grid['vol_mult'], grid['momentum_pct'], grid['target_pct'],
        grid['stop_pct'], grid['holding_days']
    ))
    
    print(f"\n  Parameter combinations: {len(combos)}")
    print(f"  TRAIN: {TRAIN_START} → {TRAIN_END}")
    print(f"  TEST:  {TEST_START} → {TEST_END}")
    print(f"  Min trades: {MIN_TRADES} | Min PF: {MIN_PROFIT_FACTOR} | Min WR: {MIN_WIN_RATE}%")
    print()
    
    # Run grid search on TRAIN
    print("  Phase 1: Grid search on TRAIN data...")
    results = []
    
    for idx, (vol_m, mom, tgt, stp, hold) in enumerate(combos):
        params = {
            'vol_mult': vol_m,
            'momentum_pct': mom,
            'target_pct': tgt,
            'stop_pct': stp,
            'holding_days': hold,
        }
        
        result = run_backtest(indicators, TRAIN_START, TRAIN_END, params)
        s = score(result)
        
        results.append({
            'params': params,
            'train': result,
            'score': s,
        })
        
        if (idx + 1) % 500 == 0:
            print(f"    {idx+1}/{len(combos)} combos tested...")
    
    print(f"  Done: {len(combos)} combinations tested")
    
    # Filter: acceptance criteria
    accepted = [r for r in results
                if r['train']['n_trades'] >= MIN_TRADES
                and r['train']['profit_factor'] >= MIN_PROFIT_FACTOR
                and r['train']['win_rate'] >= MIN_WIN_RATE]
    
    print(f"\n  Accepted (pass filters): {len(accepted)}")
    
    if not accepted:
        print("  ⚠️  No combinations passed the acceptance criteria!")
        print("  Showing top 10 by score anyway:")
        accepted = sorted(results, key=lambda x: x['score'], reverse=True)[:10]
    
    # Sort by score
    accepted.sort(key=lambda x: x['score'], reverse=True)
    
    # Take top 10
    top10 = accepted[:10]
    
    # Phase 2: Out-of-sample validation
    print(f"\n  Phase 2: Out-of-sample validation on TEST data...")
    
    for r in top10:
        test_result = run_backtest(indicators, TEST_START, TEST_END, r['params'])
        r['test'] = test_result
        
        # Check if it passed TEST
        pf_train = r['train']['profit_factor']
        pf_test = test_result['profit_factor']
        wr_train = r['train']['win_rate']
        wr_test = test_result['win_rate']
        
        # Degradation check
        pf_degradation = (pf_train - pf_test) / pf_train * 100 if pf_train > 0 else 100
        wr_degradation = (wr_train - wr_test) / wr_train * 100 if wr_train > 0 else 100
        
        r['pf_degradation'] = round(pf_degradation, 1)
        r['wr_degradation'] = round(wr_degradation, 1)
        r['passed_test'] = (pf_test >= 1.3 and wr_test >= 35.0 and test_result['n_trades'] >= 10)
    
    # Find best validated strategy
    validated = [r for r in top10 if r['passed_test']]
    
    print(f"\n  Passed out-of-sample test: {len(validated)}")
    
    # ─── Report ───
    print(f"\n{'='*70}")
    print(f"  📊 OPTIMIZATION RESULTS")
    print(f"{'='*70}")
    
    print(f"\n  Top 10 Combinations (TRAIN data):")
    print(f"  {'#':>2} {'VolM':>4} {'Mom%':>4} {'Tgt%':>4} {'Stp%':>4} {'Hold':>4} │ {'Trades':>6} {'WR%':>5} {'PF':>5} {'AvgR%':>6} {'Score':>5}")
    print(f"  {'─'*80}")
    
    for idx, r in enumerate(top10):
        p = r['params']
        t = r['train']
        print(f"  {idx+1:>2} {p['vol_mult']:>4.1f} {p['momentum_pct']:>4} {p['target_pct']:>4} {p['stop_pct']:>4} {p['holding_days']:>4} │ "
              f"{t['n_trades']:>6} {t['win_rate']:>5.1f} {t['profit_factor']:>5.2f} {t['avg_return']:>+6.2f} {r['score']:>5.1f}")
    
    print(f"\n  Out-of-sample validation (TEST data):")
    print(f"  {'#':>2} │ {'T-Trades':>8} {'T-WR%':>5} {'T-PF':>5} │ {'t-Trades':>8} {'t-WR%':>5} {'t-PF':>5} │ {'PF-deg':>6} {'WR-deg':>6} │ {'PASS':>4}")
    print(f"  {'─'*90}")
    
    for idx, r in enumerate(top10):
        t = r['train']
        te = r['test']
        passed = '✅' if r['passed_test'] else '❌'
        print(f"  {idx+1:>2} │ {t['n_trades']:>8} {t['win_rate']:>5.1f} {t['profit_factor']:>5.2f} │ "
              f"{te['n_trades']:>8} {te['win_rate']:>5.1f} {te['profit_factor']:>5.2f} │ "
              f"{r['pf_degradation']:>+6.1f}% {r['wr_degradation']:>+6.1f}% │ {passed:>4}")
    
    # Best strategy
    if validated:
        best = validated[0]
        print(f"\n  🏆 BEST VALIDATED STRATEGY:")
        p = best['params']
        print(f"     vol_mult={p['vol_mult']}, momentum={p['momentum_pct']}%, target={p['target_pct']}%, stop={p['stop_pct']}%, hold={p['holding_days']}d")
        print(f"     TRAIN: WR={best['train']['win_rate']}%, PF={best['train']['profit_factor']}, trades={best['train']['n_trades']}")
        print(f"     TEST:  WR={best['test']['win_rate']}%, PF={best['test']['profit_factor']}, trades={best['test']['n_trades']}")
        print(f"     ✅ PASSED out-of-sample validation")
    else:
        print(f"\n  ⚠️  No strategy passed out-of-sample test.")
        if top10:
            best = top10[0]
            print(f"     Best TRAIN strategy (overfit risk):")
            p = best['params']
            print(f"     vol_mult={p['vol_mult']}, momentum={p['momentum_pct']}%, target={p['target_pct']}%, stop={p['stop_pct']}%, hold={p['holding_days']}d")
            print(f"     TRAIN: WR={best['train']['win_rate']}%, PF={best['train']['profit_factor']}")
            print(f"     TEST:  WR={best['test']['win_rate']}%, PF={best['test']['profit_factor']}")
    
    # Save report
    report = {
        'generated_at': datetime.now().isoformat(),
        'total_combinations': len(combos),
        'accepted': len(accepted),
        'validated': len(validated),
        'train_period': f'{TRAIN_START} → {TRAIN_END}',
        'test_period': f'{TEST_START} → {TEST_END}',
        'top10': top10,
        'best_validated': validated[0] if validated else None,
    }
    
    report_path = PROJECT_ROOT / 'Documentation' / 'STRATEGY-OPTIMIZATION-RESULTS.md'
    report_path.parent.mkdir(exist_ok=True)
    
    with open(report_path, 'w') as f:
        f.write(f"# Strategy Optimization Results\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"## Parameters\n\n")
        f.write(f"| Parameter | Values |\n|---|---|\n")
        for k, v in PARAM_GRID.items():
            f.write(f"| {k} | {v} |\n")
        f.write(f"\n## Train/Test Split\n\n")
        f.write(f"- TRAIN: {TRAIN_START} → {TRAIN_END}\n")
        f.write(f"- TEST: {TEST_START} → {TEST_END}\n\n")
        f.write(f"## Acceptance Criteria\n\n")
        f.write(f"- Min trades: {MIN_TRADES}\n")
        f.write(f"- Min Profit Factor: {MIN_PROFIT_FACTOR}\n")
        f.write(f"- Min Win Rate: {MIN_WIN_RATE}%\n\n")
        f.write(f"## Results\n\n")
        f.write(f"- Total combinations tested: {len(combos)}\n")
        f.write(f"- Accepted (pass filters): {len(accepted)}\n")
        f.write(f"- Passed out-of-sample: {len(validated)}\n\n")
        f.write(f"## Top 10 Strategies\n\n")
        f.write(f"| # | vol_mult | mom% | tgt% | stp% | hold | TRAIN trades | TRAIN WR% | TRAIN PF | TEST trades | TEST WR% | TEST PF | Passed |\n")
        f.write(f"|---|---|---|---|---|---|---|---|---|---|---|---|---|\n")
        for idx, r in enumerate(top10):
            p = r['params']
            t = r['train']
            te = r['test']
            f.write(f"| {idx+1} | {p['vol_mult']} | {p['momentum_pct']} | {p['target_pct']} | {p['stop_pct']} | {p['holding_days']} | "
                    f"{t['n_trades']} | {t['win_rate']} | {t['profit_factor']} | "
                    f"{te['n_trades']} | {te['win_rate']} | {te['profit_factor']} | "
                    f"{'✅' if r['passed_test'] else '❌'} |\n")
        
        if validated:
            best = validated[0]
            p = best['params']
            f.write(f"\n## 🏆 Best Validated Strategy\n\n")
            f.write(f"```\n")
            f.write(f"vol_mult={p['vol_mult']}, momentum={p['momentum_pct']}%, target={p['target_pct']}%, stop={p['stop_pct']}%, hold={p['holding_days']}d\n")
            f.write(f"TRAIN: WR={best['train']['win_rate']}%, PF={best['train']['profit_factor']}, trades={best['train']['n_trades']}\n")
            f.write(f"TEST:  WR={best['test']['win_rate']}%, PF={best['test']['profit_factor']}, trades={best['test']['n_trades']}\n")
            f.write(f"```\n")
        else:
            f.write(f"\n## ⚠️ No strategy passed out-of-sample validation\n\n")
    
    print(f"\n  💾 Report saved: {report_path}")
    print(f"{'='*70}\n")
    
    return 0


if __name__ == '__main__':
    sys.exit(main())
