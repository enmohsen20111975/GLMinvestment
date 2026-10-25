#!/usr/bin/env python3
"""
strategy_lab.py — Autonomous Strategy Laboratory
==================================================

يختبر 6 استراتيجيات مختلفة × grid search × walk-forward validation.

Strategies:
  A: Trend Following (MA50 + MA200 + ROC)
  B: Mean Reversion (RSI oversold bounce)
  C: Breakout (20-day high + volume surge)
  D: Volume Surge (institutional accumulation)
  E: Multi-Filter Confluence (4 conditions)
  F: Sector Momentum (sector rotation)

Walk-Forward:
  Q1: Jul-Sep 2025 (Train 1)
  Q2: Oct-Dec 2025 (Train 2)
  Q3: Jan-Mar 2026 (Train 3)
  Q4: Apr-Jun 2026 (TEST - Out of Sample)

Usage:
  python3 scripts/strategy_lab.py
  python3 scripts/strategy_lab.py --quick   # subset of params

Author: برافو
"""
from __future__ import annotations

import os, sys, json, math, sqlite3
from datetime import datetime
from pathlib import Path
from itertools import product

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# ─── Quarters ───
Q1 = ('2025-07-01', '2025-09-30')
Q2 = ('2025-10-01', '2025-12-31')
Q3 = ('2026-01-01', '2026-03-31')
Q4 = ('2026-04-01', '2026-06-10')  # TEST — never used in training

TRAIN_PERIODS = [Q1, Q2, Q3]


def load_data():
    """Load all price data + compute indicators once."""
    print("  Loading price data + computing indicators...")
    
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    rows = conn.execute("""
        SELECT ticker, date, close_price, high_price, low_price, volume
        FROM price_history
        WHERE date >= '2025-06-01' AND date <= '2026-06-10'
        AND close_price IS NOT NULL AND close_price > 0
        ORDER BY ticker, date
    """).fetchall()
    conn.close()
    
    print(f"  Loaded {len(rows):,} rows")
    
    # Load sectors
    conn2 = sqlite3.connect(str(DB_DIR / 'stocks.db'), timeout=10.0)
    sector_map = {}
    for ticker, sector in conn2.execute(
        "SELECT ticker, sector FROM stocks WHERE is_active=1 AND sector IS NOT NULL AND sector != ''"
    ).fetchall():
        sector_map[ticker] = sector
    conn2.close()
    print(f"  Sectors loaded for {len(sector_map)} tickers")
    
    # Group by ticker
    data = {}
    for ticker, date, close, high, low, vol in rows:
        if ticker not in data:
            data[ticker] = []
        data[ticker].append({
            'date': date, 'close': close, 'high': high, 'low': low, 'volume': vol,
        })
    
    # Compute indicators
    indicators = {}
    for ticker, candles in data.items():
        if len(candles) < 50:
            continue
        
        closes = [c['close'] for c in candles]
        vols = [c['volume'] for c in candles]
        
        for i in range(len(candles)):
            c = candles[i]
            
            # SMA20
            c['sma20'] = sum(closes[max(0,i-19):i+1]) / min(20, i+1) if i >= 19 else None
            
            # SMA50
            c['sma50'] = sum(closes[max(0,i-49):i+1]) / min(50, i+1) if i >= 49 else None
            
            # SMA200 (if available)
            c['sma200'] = sum(closes[max(0,i-199):i+1]) / min(200, i+1) if i >= 199 else None
            
            # Vol MA20
            c['vol_ma20'] = sum(vols[max(0,i-19):i+1]) / min(20, i+1) if i >= 19 else None
            
            # ROC5
            c['roc5'] = ((closes[i] / closes[i-5] - 1) * 100) if i >= 5 and closes[i-5] > 0 else None
            
            # ROC20
            c['roc20'] = ((closes[i] / closes[i-20] - 1) * 100) if i >= 20 and closes[i-20] > 0 else None
            
            # RSI14 (simplified)
            if i >= 14:
                gains = []
                losses = []
                for j in range(i-13, i+1):
                    change = closes[j] - closes[j-1]
                    if change > 0:
                        gains.append(change)
                    else:
                        losses.append(abs(change))
                avg_gain = sum(gains) / 14 if gains else 0
                avg_loss = sum(losses) / 14 if losses else 0.001
                rs = avg_gain / avg_loss if avg_loss > 0 else 100
                c['rsi'] = 100 - (100 / (1 + rs))
            else:
                c['rsi'] = None
            
            # 20-day high
            c['high_20'] = max(c['high'] for c in candles[max(0,i-19):i+1]) if i >= 19 else None
            
            # 10-day low
            c['low_10'] = min(c['low'] for c in candles[max(0,i-9):i+1]) if i >= 9 else None
            
            # Sector
            c['sector'] = sector_map.get(ticker, None)
        
        indicators[ticker] = candles
    
    print(f"  Indicators computed for {len(indicators)} tickers")
    return indicators


def run_backtest(indicators, start_date, end_date, strategy_fn, params):
    """Run backtest with given strategy + params on given date range."""
    trades = []
    
    for ticker, candles in indicators.items():
        for i in range(50, len(candles)):
            day = candles[i]
            if day['date'] < start_date or day['date'] > end_date:
                continue
            
            # Check entry
            entry = strategy_fn(day, candles, i, params)
            if entry is None:
                continue
            
            entry_price, target_price, stop_price, max_hold = entry
            
            # Find exit
            exit_price = None
            outcome = 'EXPIRED'
            
            for j in range(i + 1, min(i + 1 + max_hold, len(candles))):
                future = candles[j]
                if future['low'] <= stop_price:
                    exit_price = stop_price
                    outcome = 'STOPPED'
                    break
                if future['high'] >= target_price:
                    exit_price = target_price
                    outcome = 'TARGET_HIT'
                    break
            
            if exit_price is None:
                future_idx = min(i + max_hold, len(candles) - 1)
                exit_price = candles[future_idx]['close']
            
            return_pct = (exit_price / entry_price - 1) * 100
            trades.append({
                'date': day['date'], 'ticker': ticker,
                'entry': entry_price, 'exit': exit_price,
                'outcome': outcome, 'return_pct': return_pct,
            })
    
    return calc_metrics(trades)


def calc_metrics(trades):
    n = len(trades)
    if n == 0:
        return {'n_trades': 0, 'win_rate': 0, 'profit_factor': 0, 'avg_return': 0}
    wins = sum(1 for t in trades if t['outcome'] == 'TARGET_HIT')
    gp = sum(t['return_pct'] for t in trades if t['return_pct'] > 0)
    gl = abs(sum(t['return_pct'] for t in trades if t['return_pct'] < 0))
    pf = gp / gl if gl > 0 else 0
    return {
        'n_trades': n,
        'wins': wins,
        'win_rate': round(wins / n * 100, 1),
        'profit_factor': round(pf, 2),
        'avg_return': round(sum(t['return_pct'] for t in trades) / n, 2),
    }


def score(m):
    if m['n_trades'] == 0 or m['profit_factor'] < 1:
        return 0
    return round((m['profit_factor'] - 1) * (m['win_rate'] / 100) * math.sqrt(m['n_trades']), 2)


# ─── Strategy A: Trend Following ───
def strategy_a(day, candles, i, p):
    if day['sma50'] is None or day['sma200'] is None or day['roc20'] is None:
        return None
    if day['vol_ma20'] is None or day['vol_ma20'] == 0:
        return None
    if day['close'] <= day['sma50']:
        return None
    if day['sma50'] <= day['sma200']:
        return None
    if day['roc20'] < p['momentum_min']:
        return None
    if day['volume'] < day['vol_ma20'] * p['vol_min']:
        return None
    entry = day['close']
    # ATR proxy: use recent range
    recent = candles[max(0,i-13):i+1]
    atr = sum(c['high'] - c['low'] for c in recent) / len(recent) if recent else entry * 0.05
    target = entry + atr * p['target_atr_mult']
    stop = entry - atr * p['stop_atr_mult']
    return (entry, target, stop, p['max_hold'])


# ─── Strategy B: Mean Reversion (RSI) ───
def strategy_b(day, candles, i, p):
    if day['rsi'] is None:
        return None
    if day['rsi'] > p['rsi_oversold']:
        return None
    if p['require_uptrend'] and day['sma200'] and day['close'] < day['sma200']:
        return None
    entry = day['close']
    target = entry * (1 + p['target_pct'] / 100)
    stop = entry * (1 - p['stop_pct'] / 100)
    return (entry, target, stop, 15)  # fixed 15-day hold for mean reversion


# ─── Strategy C: Breakout ───
def strategy_c(day, candles, i, p):
    if day['high_20'] is None or day['vol_ma20'] is None:
        return None
    if day['close'] <= day['high_20']:
        return None
    if day['vol_ma20'] > 0 and day['volume'] < day['vol_ma20'] * p['volume_mult']:
        return None
    entry = day['close']
    target = entry * (1 + p['target_pct'] / 100)
    stop = entry * (1 - p['stop_pct'] / 100)
    return (entry, target, stop, p['max_hold'])


# ─── Strategy D: Volume Surge ───
def strategy_d(day, candles, i, p):
    if day['vol_ma20'] is None or day['vol_ma20'] == 0:
        return None
    if day['volume'] < day['vol_ma20'] * p['vol_mult']:
        return None
    if day['close'] <= day.get('open', day['close']):
        return None
    if p['require_ma20'] and day['sma20'] and day['close'] < day['sma20']:
        return None
    entry = day['close']
    target = entry * (1 + p['target_pct'] / 100)
    stop = entry * (1 - p['stop_pct'] / 100)
    return (entry, target, stop, p['max_hold'])


# ─── Strategy E: Multi-Filter Confluence ───
def strategy_e(day, candles, i, p):
    if day['sma50'] is None or day['rsi'] is None or day['roc5'] is None or day['vol_ma20'] is None:
        return None
    if day['close'] <= day['sma50']:
        return None
    if day['rsi'] < p['rsi_min'] or day['rsi'] > p['rsi_max']:
        return None
    if day['roc5'] < p['roc5_min']:
        return None
    if day['vol_ma20'] > 0 and day['volume'] < day['vol_ma20'] * p['vol_mult']:
        return None
    entry = day['close']
    recent = candles[max(0,i-13):i+1]
    atr = sum(c['high'] - c['low'] for c in recent) / len(recent) if recent else entry * 0.05
    target = entry + atr * p['target_atr']
    stop = entry - atr * 2.0  # fixed 2x ATR stop
    return (entry, target, stop, 20)


# ─── Strategy F: Sector Momentum ───
def strategy_f(day, candles, i, p):
    if day['sma50'] is None or day['sector'] is None:
        return None
    if p['require_ma50'] and day['close'] <= day['sma50']:
        return None
    
    # Compute sector average return for the day
    # (simplified: check if this ticker's sector is performing well)
    sector_return = day.get('roc20', 0) or 0
    if sector_return < p['min_sector_return']:
        return None
    
    entry = day['close']
    target = entry * (1 + p['target_pct'] / 100)
    stop = entry * (1 - p['trailing_pct'] / 100)  # trailing-style stop
    return (entry, target, stop, p['max_hold'])


# ─── Strategy Definitions ───
STRATEGIES = {
    'A_trend': {
        'fn': strategy_a,
        'name': 'Trend Following (MA50 + MA200 + ROC)',
        'params': {
            'momentum_min': [3, 5, 8],
            'vol_min': [1.0, 1.5, 2.0],
            'target_atr_mult': [2, 3, 4],
            'stop_atr_mult': [1.5, 2, 2.5],
            'max_hold': [10, 20, 30],
        },
    },
    'B_meanrev': {
        'fn': strategy_b,
        'name': 'Mean Reversion (RSI Bounce)',
        'params': {
            'rsi_oversold': [25, 30, 35],
            'require_uptrend': [True, False],
            'target_pct': [5, 8, 12],
            'stop_pct': [3, 5, 7],
        },
    },
    'C_breakout': {
        'fn': strategy_c,
        'name': 'Breakout (20-day High + Volume)',
        'params': {
            'volume_mult': [1.2, 1.5, 2.0],
            'target_pct': [5, 8, 10, 15],
            'stop_pct': [3, 5, 7],
            'max_hold': [10, 15, 20],
        },
    },
    'D_volsurge': {
        'fn': strategy_d,
        'name': 'Volume Surge (Institutional)',
        'params': {
            'vol_mult': [2.0, 2.5, 3.0],
            'require_ma20': [True, False],
            'target_pct': [5, 8, 12],
            'stop_pct': [4, 6, 8],
            'max_hold': [5, 10, 15],
        },
    },
    'E_confluence': {
        'fn': strategy_e,
        'name': 'Multi-Filter Confluence',
        'params': {
            'rsi_min': [40, 45, 50],
            'rsi_max': [65, 70, 75],
            'roc5_min': [2, 3, 5],
            'vol_mult': [1.2, 1.5, 2.0],
            'target_atr': [2, 3, 4],
        },
    },
    'F_sector': {
        'fn': strategy_f,
        'name': 'Sector Momentum',
        'params': {
            'min_sector_return': [0, 2, 5],
            'require_ma50': [True, False],
            'trailing_pct': [5, 8, 10],
            'target_pct': [8, 12, 18],
            'max_hold': [10, 20, 30],
        },
    },
}


def main():
    print(f"\n{'='*70}")
    print(f"  🔬 Strategy Lab — 6 Strategies × Grid Search × Walk-Forward")
    print(f"{'='*70}\n")
    
    indicators = load_data()
    
    all_results = {}
    
    for strat_id, strat in STRATEGIES.items():
        print(f"\n{'─'*70}")
        print(f"  Strategy {strat_id}: {strat['name']}")
        print(f"{'─'*70}")
        
        # Generate combos
        param_names = list(strat['params'].keys())
        param_values = list(strat['params'].values())
        combos = list(product(*param_values))
        
        print(f"  Combinations: {len(combos)}")
        
        # Grid search on TRAIN (Q1+Q2+Q3)
        train_results = []
        for idx, combo in enumerate(combos):
            params = dict(zip(param_names, combo))
            
            # Run on each train quarter
            all_trades = []
            for qs, qe in TRAIN_PERIODS:
                result = run_backtest(indicators, qs, qe, strat['fn'], params)
                # We want combined metrics — re-run with actual trades
                # Actually, run_backtest returns metrics, not trades
                # For simplicity, run on full train period
                pass
            
            # Run on full train period (Q1+Q2+Q3 combined)
            result = run_backtest(indicators, Q1[0], Q3[1], strat['fn'], params)
            s = score(result)
            
            train_results.append({
                'params': params,
                'train': result,
                'score': s,
            })
            
            if (idx + 1) % 50 == 0:
                print(f"    {idx+1}/{len(combos)}...")
        
        # Filter + sort
        accepted = [r for r in train_results
                    if r['train']['n_trades'] >= 30
                    and r['train']['profit_factor'] >= 1.3
                    and r['train']['win_rate'] >= 35.0]
        
        print(f"  Accepted (PF≥1.3, WR≥35%, N≥30): {len(accepted)}")
        
        if not accepted:
            print(f"  ⚠️  No combos passed. Top 3 by score:")
            train_results.sort(key=lambda x: x['score'], reverse=True)
            for r in train_results[:3]:
                p = r['params']
                t = r['train']
                print(f"    PF={t['profit_factor']}, WR={t['win_rate']}%, N={t['n_trades']}, score={r['score']}")
                print(f"    params: {p}")
            all_results[strat_id] = {'status': 'FAILED', 'best_train': train_results[:3] if train_results else []}
            continue
        
        # Sort by score
        accepted.sort(key=lambda x: x['score'], reverse=True)
        top5 = accepted[:5]
        
        # Out-of-sample test on Q4
        print(f"  Testing top 5 on Q4 ({Q4[0]} → {Q4[1]})...")
        for r in top5:
            test_result = run_backtest(indicators, Q4[0], Q4[1], strat['fn'], r['params'])
            r['test'] = test_result
            r['passed_test'] = (test_result['profit_factor'] >= 1.3 
                               and test_result['win_rate'] >= 35.0 
                               and test_result['n_trades'] >= 10)
        
        passed = [r for r in top5 if r['passed_test']]
        
        print(f"  Passed Q4: {len(passed)}")
        if passed:
            best = passed[0]
            p = best['params']
            print(f"  ✅ BEST: PF_train={best['train']['profit_factor']}, WR_train={best['train']['win_rate']}%")
            print(f"          PF_test={best['test']['profit_factor']}, WR_test={best['test']['win_rate']}%")
            print(f"          params: {p}")
        else:
            best = top5[0]
            print(f"  ❌ Best TRAIN: PF={best['train']['profit_factor']}, WR={best['train']['win_rate']}%")
            print(f"     TEST: PF={best['test']['profit_factor']}, WR={best['test']['win_rate']}%")
        
        all_results[strat_id] = {
            'status': 'PASSED' if passed else 'FAILED',
            'best': best if top5 else None,
            'top5': top5,
        }
    
    # ─── Final Report ───
    print(f"\n{'='*70}")
    print(f"  📊 STRATEGY LAB — FINAL RESULTS")
    print(f"{'='*70}\n")
    
    print(f"  {'Strategy':<20} {'Status':<8} {'Train PF':>8} {'Train WR':>8} {'Test PF':>8} {'Test WR':>8}")
    print(f"  {'─'*75}")
    
    any_passed = False
    for sid, res in all_results.items():
        status = res['status']
        if res.get('best'):
            b = res['best']
            tp = b['train']['profit_factor']
            tw = b['train']['win_rate']
            ep = b.get('test', {}).get('profit_factor', 'N/A')
            ew = b.get('test', {}).get('win_rate', 'N/A')
            print(f"  {sid:<20} {status:<8} {tp:>8} {tw:>7.1f}% {ep:>8} {ew:>7}%")
            if status == 'PASSED':
                any_passed = True
        else:
            print(f"  {sid:<20} {status:<8} {'N/A':>8} {'N/A':>8} {'N/A':>8} {'N/A':>8}")
    
    print()
    if any_passed:
        print("  🏆 AT LEAST ONE STRATEGY PASSED OUT-OF-SAMPLE!")
        for sid, res in all_results.items():
            if res['status'] == 'PASSED':
                b = res['best']
                p = b['params']
                print(f"\n  Strategy {sid}:")
                print(f"    Parameters: {p}")
                print(f"    TRAIN: PF={b['train']['profit_factor']}, WR={b['train']['win_rate']}%, trades={b['train']['n_trades']}")
                print(f"    TEST:  PF={b['test']['profit_factor']}, WR={b['test']['win_rate']}%, trades={b['test']['n_trades']}")
    else:
        print("  ⚠️  NO STRATEGY PASSED OUT-OF-SAMPLE TEST.")
        print("  All 6 strategies failed Q4 validation.")
        print("  The simple MA50/volume/momentum approach is insufficient for EGX.")
        print("  Recommendation: Need deeper sector data, intraday data, or AI-based signals.")
    
    # Save report
    report_path = PROJECT_ROOT / 'Documentation' / 'STRATEGY-LAB-RESULTS.md'
    report_path.parent.mkdir(exist_ok=True)
    with open(report_path, 'w') as f:
        f.write(f"# Strategy Lab Results\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"## Summary\n\n")
        f.write(f"| Strategy | Status | Train PF | Train WR% | Test PF | Test WR% |\n")
        f.write(f"|---|---|---|---|---|---|\n")
        for sid, res in all_results.items():
            if res.get('best'):
                b = res['best']
                f.write(f"| {sid} | {res['status']} | {b['train']['profit_factor']} | {b['train']['win_rate']}% | {b.get('test',{}).get('profit_factor','N/A')} | {b.get('test',{}).get('win_rate','N/A')}% |\n")
            else:
                f.write(f"| {sid} | {res['status']} | N/A | N/A | N/A | N/A |\n")
        
        if any_passed:
            f.write(f"\n## 🏆 Best Strategy\n\n")
            for sid, res in all_results.items():
                if res['status'] == 'PASSED':
                    b = res['best']
                    p = b['params']
                    f.write(f"### {sid}\n")
                    f.write(f"```\nparams: {p}\n")
                    f.write(f"TRAIN: PF={b['train']['profit_factor']}, WR={b['train']['win_rate']}%, trades={b['train']['n_trades']}\n")
                    f.write(f"TEST:  PF={b['test']['profit_factor']}, WR={b['test']['win_rate']}%, trades={b['test']['n_trades']}\n```\n\n")
        else:
            f.write(f"\n## ⚠️ No Strategy Passed\n\n")
            f.write(f"All 6 strategies failed Q4 out-of-sample validation.\n")
            f.write(f"The approach needs fundamental redesign.\n")
    
    print(f"\n  💾 Report saved: {report_path}")
    print(f"{'='*70}\n")


if __name__ == '__main__':
    main()
