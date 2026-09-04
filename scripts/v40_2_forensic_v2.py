#!/usr/bin/env python3
"""
Forensic analysis v2 — with anomaly filter.
Any stock moving >50% in 5 days = data anomaly → reject.
"""
import os, sys, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from collections import defaultdict

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

# Import + monkey-patch the load_universe to add anomaly filter
import v40_2_flag_ablation as ablation

original_load = ablation.load_universe

def load_universe_with_anomaly_filter():
    """Load universe then remove tickers with anomalous price jumps."""
    universe = original_load()
    prices = universe['prices']
    clean_prices = {}
    anomalies_found = []
    for ticker, data in prices.items():
        if len(data) < 10:
            clean_prices[ticker] = data
            continue
        # Check for >50% move in 5-day window
        is_anomalous = False
        for i in range(len(data) - 5):
            window = data[i:i+6]
            p_start = window[0]['c']
            p_end = window[5]['c']
            if p_start > 0:
                change = abs((p_end - p_start) / p_start)
                if change > 0.50:  # 50% in 5 days = anomaly
                    is_anomalous = True
                    anomalies_found.append((ticker, window[0]['date'], window[5]['date'], p_start, p_end, change*100))
                    break
        if not is_anomalous:
            clean_prices[ticker] = data
    universe['prices'] = clean_prices
    print(f'[ANOMALY FILTER] Rejected {len(anomalies_found)} tickers with >50% moves in 5 days:')
    for a in anomalies_found[:15]:
        print(f'  {a[0]}: {a[1]} → {a[2]} | {a[3]:.2f} → {a[4]:.2f} ({a[5]:.1f}%)')
    if len(anomalies_found) > 15:
        print(f'  ... and {len(anomalies_found) - 15} more')
    return universe

# Replace the load_universe in both modules
ablation.load_universe = load_universe_with_anomaly_filter
import v40_2_full_pipeline as pipeline
pipeline.load_universe = load_universe_with_anomaly_filter

from v40_2_full_pipeline import Config, run_backtest, OUTPUT_DIR, START_DATE, END_DATE

# === Run FINAL config with anomaly filter ===
print('='*80)
print('FORENSIC ANALYSIS v2 — WITH ANOMALY FILTER')
print('distribution_exit + egx30_down_hold + partial_exit')
print('='*80)

c = Config('FINAL_CLEAN')
c.distribution_exit = True
c.egx30_down_hold = True
c.partial_exit = True

trades, metrics = run_backtest(c, START_DATE, END_DATE)
print(f'\nMetrics (clean): {metrics}')

# === Return distribution ===
print('\n' + '='*80)
print('RETURN DISTRIBUTION (clean)')
print('='*80)
pnls = sorted([t['pnl_pct'] for t in trades])
if pnls:
    big_wins = [t for t in trades if t['pnl_pct'] >= 20]
    huge_wins = [t for t in trades if t['pnl_pct'] >= 50]
    big_losses = [t for t in trades if t['pnl_pct'] <= -5]
    print(f'Total trades: {len(trades)}')
    print(f'Trades ≥ +20%: {len(big_wins)} ({len(big_wins)/len(trades)*100:.1f}%)')
    print(f'Trades ≥ +50%: {len(huge_wins)} ({len(huge_wins)/len(trades)*100:.1f}%)')
    print(f'Trades ≤ -5%: {len(big_losses)} ({len(big_losses)/len(trades)*100:.1f}%)')
    print(f'Percentiles: Min={min(pnls):.2f} | P25={pnls[len(pnls)//4]:.2f} | P50={pnls[len(pnls)//2]:.2f} | P75={pnls[3*len(pnls)//4]:.2f} | Max={max(pnls):.2f}')

# === Top 5 winners/losers ===
print('\n' + '--- TOP 5 WINNERS ---')
winners = sorted(trades, key=lambda x: x['pnl_pct'], reverse=True)[:5]
for t in winners:
    print(f"  {t['ticker']:6s} entry={t['entry_price']:8.2f} exit={t['exit_price']:8.2f} pnl={t['pnl_pct']:+7.2f}% reason={t['exit_reason']}")

print('\n--- TOP 5 LOSERS ---')
losers = sorted(trades, key=lambda x: x['pnl_pct'])[:5]
for t in losers:
    print(f"  {t['ticker']:6s} entry={t['entry_price']:8.2f} exit={t['exit_price']:8.2f} pnl={t['pnl_pct']:+7.2f}% reason={t['exit_reason']}")

# === Position sizing ===
pos_values = [t['shares'] * t['entry_price'] for t in trades]
if pos_values:
    avg_pos = sum(pos_values) / len(pos_values)
    print(f'\n--- POSITION SIZING ---')
    print(f'Avg position: {avg_pos:.0f} EGP ({avg_pos/100000*100:.1f}% of capital)')
    print(f'Max position: {max(pos_values):.0f} EGP')

# === Exit reasons ===
print('\n--- EXIT REASONS ---')
reasons = defaultdict(lambda: {'count': 0, 'pnl_sum': 0})
for t in trades:
    reasons[t['exit_reason']]['count'] += 1
    reasons[t['exit_reason']]['pnl_sum'] += t['pnl_pct']
for reason, stats in sorted(reasons.items(), key=lambda x: x[1]['count'], reverse=True):
    avg_pnl = stats['pnl_sum'] / stats['count']
    print(f'  {reason:25s}: {stats["count"]:>4} trades, avg {avg_pnl:+.2f}%, total {stats["pnl_sum"]:+.2f}%')

# === Holding days ===
holding_days = []
for t in trades:
    try:
        entry = datetime.strptime(t['entry_date'], '%Y-%m-%d')
        exit_d = datetime.strptime(t['exit_date'], '%Y-%m-%d')
        holding_days.append((exit_d - entry).days)
    except:
        pass
if holding_days:
    print(f'\n--- HOLDING DAYS ---')
    print(f'Avg: {sum(holding_days)/len(holding_days):.1f} | Median: {sorted(holding_days)[len(holding_days)//2]} | Min: {min(holding_days)} | Max: {max(holding_days)}')

# === Save clean trades ===
csv_path = OUTPUT_DIR / 'FINAL_trades_clean.csv'
with open(csv_path, 'w') as f:
    f.write('ticker,entry_date,exit_date,entry_price,exit_price,shares,pnl_pct,exit_reason,position_size_mult,holding_days,position_value_egp\n')
    for t in sorted(trades, key=lambda x: x['entry_date']):
        try:
            entry = datetime.strptime(t['entry_date'], '%Y-%m-%d')
            exit_d = datetime.strptime(t['exit_date'], '%Y-%m-%d')
            days = (exit_d - entry).days
        except:
            days = ''
        pos_val = t['shares'] * t['entry_price']
        f.write(f"{t['ticker']},{t['entry_date']},{t['exit_date']},{t['entry_price']:.2f},{t['exit_price']:.2f},{t['shares']},{t['pnl_pct']:.2f},{t['exit_reason']},{t.get('position_size_mult',1.0):.2f},{days},{pos_val:.0f}\n")
print(f'\n📄 Clean trades: {csv_path}')

# === VERDICT ===
print('\n' + '='*80)
print('FINAL VERDICT (after anomaly filter)')
print('='*80)
print(f'PF: {metrics["profit_factor"]}')
print(f'WR: {metrics["win_rate"]}%')
print(f'MaxDD: {metrics["max_dd"]}%')
print(f'Exp: {metrics["expectancy"]}%')
print(f'Return: {metrics["total_return"]}%')
print(f'Trades: {metrics["trades"]}')

# Compare with before
print(f'\nBEFORE anomaly filter: PF=4.94, WR=59.33%, DD=-2.39%, trades=150')
print(f'AFTER anomaly filter:  PF={metrics["profit_factor"]}, WR={metrics["win_rate"]}%, DD={metrics["max_dd"]}%, trades={metrics["trades"]}')
