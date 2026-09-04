#!/usr/bin/env python3
"""
Forensic analysis of the FINAL config (distribution_exit + egx30_down_hold + partial_exit).
كل trade + توزيع العوائد + equity curve + sanity checks.
"""
import os, sys, json, sqlite3, math
from pathlib import Path
from collections import defaultdict
from datetime import datetime

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
from v40_2_full_pipeline import (
    Config, run_backtest, load_universe, OUTPUT_DIR,
    START_DATE, END_DATE, INITIAL_CAPITAL
)

# === Run FINAL config ===
print('='*80)
print('FORENSIC ANALYSIS — FINAL CONFIG')
print('distribution_exit + egx30_down_hold + partial_exit')
print('='*80)

c = Config('FINAL')
c.distribution_exit = True
c.egx30_down_hold = True
c.partial_exit = True

trades, metrics = run_backtest(c, START_DATE, END_DATE)
print(f'\nMetrics: {metrics}')

# === Sanity check #1: Are trades duplicating same position? ===
print('\n' + '='*80)
print('CHECK #1: Position duplication (same ticker multiple entries same day?)')
print('='*80)
by_date = defaultdict(list)
for t in trades:
    by_date[(t['ticker'], t['entry_date'])].append(t)
dups = {k: v for k, v in by_date.items() if len(v) > 1}
print(f'Ticker+Entry combos with >1 trade: {len(dups)}')
if dups:
    for k, v in list(dups.items())[:3]:
        print(f'  {k}: {[{"reason": t["exit_reason"], "shares": t["shares"], "pnl": t["pnl_pct"]} for t in v]}')

# === Sanity check #2: Look-ahead bias check ===
print('\n' + '='*80)
print('CHECK #2: Look-ahead bias (exit before entry date?)')
print('='*80)
look_ahead = [t for t in trades if t['exit_date'] < t['entry_date']]
print(f'Trades with exit < entry: {len(look_ahead)}')
zero_hold = [t for t in trades if t['exit_date'] == t['entry_date']]
print(f'Trades with 0 holding days (same day exit): {len(zero_hold)}')

# === Sanity check #3: Position size analysis ===
print('\n' + '='*80)
print('CHECK #3: Position sizing (is it pygmy?)')
print('='*80)
pos_values = []
for t in trades:
    pos_value = t['shares'] * t['entry_price']
    pos_values.append(pos_value)
if pos_values:
    avg_pos = sum(pos_values) / len(pos_values)
    max_pos = max(pos_values)
    min_pos = min(pos_values)
    print(f'Avg position value: {avg_pos:.0f} EGP ({avg_pos/INITIAL_CAPITAL*100:.1f}% of capital)')
    print(f'Max position value: {max_pos:.0f} EGP ({max_pos/INITIAL_CAPITAL*100:.1f}% of capital)')
    print(f'Min position value: {min_pos:.0f} EGP ({min_pos/INITIAL_CAPITAL*100:.1f}% of capital)')

# === Sanity check #4: Return distribution ===
print('\n' + '='*80)
print('CHECK #4: Return distribution')
print('='*80)
pnls = [t['pnl_pct'] for t in trades]
pnls.sort()
big_wins = [t for t in trades if t['pnl_pct'] >= 20]
big_losses = [t for t in trades if t['pnl_pct'] <= -5]
huge_wins = [t for t in trades if t['pnl_pct'] >= 50]
print(f'Total trades: {len(trades)}')
print(f'Trades ≥ +20%: {len(big_wins)} ({len(big_wins)/len(trades)*100:.1f}%)')
print(f'Trades ≥ +50%: {len(huge_wins)} ({len(huge_wins)/len(trades)*100:.1f}%)')
print(f'Trades ≤ -5%: {len(big_losses)} ({len(big_losses)/len(trades)*100:.1f}%)')
print(f'\nPercentiles:')
print(f'  Min: {min(pnls):.2f}%')
print(f'  P10: {pnls[len(pnls)//10]:.2f}%')
print(f'  P25: {pnls[len(pnls)//4]:.2f}%')
print(f'  P50 (median): {pnls[len(pnls)//2]:.2f}%')
print(f'  P75: {pnls[3*len(pnls)//4]:.2f}%')
print(f'  P90: {pnls[9*len(pnls)//10]:.2f}%')
print(f'  Max: {max(pnls):.2f}%')

# === Top 5 winners + losers ===
print('\n' + '='*80)
print('TOP 5 WINNERS')
print('='*80)
winners = sorted(trades, key=lambda x: x['pnl_pct'], reverse=True)[:5]
for t in winners:
    print(f"  {t['ticker']:6s} entry={t['entry_price']:8.2f} exit={t['exit_price']:8.2f} "
          f"shares={t['shares']:>5} pnl={t['pnl_pct']:+7.2f}% reason={t['exit_reason']}")
print(f'\n  Sum of top 5 wins: {sum(t["pnl_pct"] for t in winners):.2f}%')
print(f'  Sum of ALL wins: {sum(t["pnl_pct"] for t in trades if t["pnl_pct"] > 0):.2f}%')
print(f'  Top 5 share of total wins: {sum(t["pnl_pct"] for t in winners)/sum(t["pnl_pct"] for t in trades if t["pnl_pct"] > 0)*100:.1f}%')

print('\n' + '='*80)
print('TOP 5 LOSERS')
print('='*80)
losers = sorted(trades, key=lambda x: x['pnl_pct'])[:5]
for t in losers:
    print(f"  {t['ticker']:6s} entry={t['entry_price']:8.2f} exit={t['exit_price']:8.2f} "
          f"shares={t['shares']:>5} pnl={t['pnl_pct']:+7.2f}% reason={t['exit_reason']}")

# === Holding days ===
print('\n' + '='*80)
print('HOLDING DAYS ANALYSIS')
print('='*80)
holding_days = []
for t in trades:
    try:
        entry = datetime.strptime(t['entry_date'], '%Y-%m-%d')
        exit_d = datetime.strptime(t['exit_date'], '%Y-%m-%d')
        days = (exit_d - entry).days
        holding_days.append(days)
    except:
        pass
if holding_days:
    print(f'Avg holding days: {sum(holding_days)/len(holding_days):.1f}')
    print(f'Median: {sorted(holding_days)[len(holding_days)//2]}')
    print(f'Min: {min(holding_days)} | Max: {max(holding_days)}')
    print(f'Distribution:')
    buckets = {'0-3 days': 0, '4-7 days': 0, '8-14 days': 0, '15-30 days': 0, '>30 days': 0}
    for d in holding_days:
        if d <= 3: buckets['0-3 days'] += 1
        elif d <= 7: buckets['4-7 days'] += 1
        elif d <= 14: buckets['8-14 days'] += 1
        elif d <= 30: buckets['15-30 days'] += 1
        else: buckets['>30 days'] += 1
    for k, v in buckets.items():
        print(f'  {k}: {v} ({v/len(holding_days)*100:.1f}%)')

# === Exit reasons breakdown ===
print('\n' + '='*80)
print('EXIT REASONS BREAKDOWN')
print('='*80)
reasons = defaultdict(lambda: {'count': 0, 'pnl_sum': 0})
for t in trades:
    reasons[t['exit_reason']]['count'] += 1
    reasons[t['exit_reason']]['pnl_sum'] += t['pnl_pct']
for reason, stats in sorted(reasons.items(), key=lambda x: x[1]['count'], reverse=True):
    avg_pnl = stats['pnl_sum'] / stats['count']
    print(f'  {reason:25s}: {stats["count"]:>4} trades, avg pnl {avg_pnl:+.2f}%, total {stats["pnl_sum"]:+.2f}%')

# === Equity Curve ===
print('\n' + '='*80)
print('EQUITY CURVE (day by day)')
print('='*80)
# Re-run to get portfolio_history
universe = load_universe()
prices = universe['prices']
# Build date index for the backtest
all_dates = sorted({d['date'] for t in prices for d in prices[t]})
trading_dates = all_dates[::5]  # SCAN_INTERVAL=5

# Rebuild equity curve from trades + open positions simulation
# This is approximate — for exact curve we'd need portfolio_history from run_backtest
# But we can compute it from trades by tracking entry/exit cash flows
equity_curve = []
cash = INITIAL_CAPITAL
open_value = 0
# For each trading date, compute: cash + sum(open positions market value)
positions_by_date = defaultdict(list)
for t in trades:
    positions_by_date[t['entry_date']].append(('OPEN', t))
    positions_by_date[t['exit_date']].append(('CLOSE', t))

# Simpler approach: just compute equity at each trade exit
print('Date         | Equity (EGP)  | Change from prev')
print('-'*60)
equity = INITIAL_CAPITAL
prev_equity = INITIAL_CAPITAL
sorted_trades = sorted(trades, key=lambda x: x['exit_date'])
sample_dates = sorted_trades[::max(1, len(sorted_trades)//15)]  # ~15 samples
for t in sample_dates:
    pnl_egp = (t['exit_price'] - t['entry_price']) * t['shares']
    equity += pnl_egp
    change = (equity - prev_equity) / prev_equity * 100
    print(f"{t['exit_date']} | {equity:>12,.0f} | {change:+6.2f}%")
    prev_equity = equity

# === Save trades CSV ===
csv_path = OUTPUT_DIR / 'FINAL_trades.csv'
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
print(f'\n📄 Trades saved: {csv_path}')

# === Out-of-sample test on 2025 data ===
print('\n' + '='*80)
print('OUT-OF-SAMPLE TEST — 2025 DATA (if available)')
print('='*80)
conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'data_engine.db'), timeout=10)
cur = conn.execute("SELECT MIN(price_date), MAX(price_date) FROM egksco_price_history")
date_range = cur.fetchone()
print(f'Price history range: {date_range[0]} → {date_range[1]}')
conn.close()

# Test on 2025-06-01 → 2025-12-31 (if exists)
test_start = '2025-06-01'
test_end = '2025-12-31'
print(f'\nRunning FINAL config on {test_start} → {test_end}...')
trades_2025, metrics_2025 = run_backtest(c, test_start, test_end)
print(f'2025 results: {metrics_2025}')

# === Final verdict ===
print('\n' + '='*80)
print('FORENSIC VERDICT')
print('='*80)
verdicts = []
# Check 1: PF concentration
total_wins = sum(t['pnl_pct'] for t in trades if t['pnl_pct'] > 0)
top5_wins = sum(t['pnl_pct'] for t in winners)
top5_share = top5_wins / total_wins * 100 if total_wins > 0 else 0
print(f'Top 5 wins share of total: {top5_share:.1f}%')
if top5_share > 50:
    verdicts.append(f'⚠️ PF CONCENTRATION: Top 5 trades = {top5_share:.1f}% of total wins')
else:
    verdicts.append(f'✓ PF distributed: Top 5 = {top5_share:.1f}% of total wins')

# Check 2: Position size
if pos_values:
    avg_pct = avg_pos / INITIAL_CAPITAL * 100
    if avg_pct < 5:
        verdicts.append(f'⚠️ PYGMY SIZING: avg position = {avg_pct:.1f}% of capital')
    else:
        verdicts.append(f'✓ Reasonable sizing: avg position = {avg_pct:.1f}% of capital')

# Check 3: Look-ahead
if look_ahead or zero_hold:
    verdicts.append(f'⚠️ LOOK-AHEAD: {len(look_ahead)} exit<entry, {len(zero_hold)} same-day')
else:
    verdicts.append('✓ No look-ahead bias')

# Check 4: Out-of-sample
if isinstance(metrics_2025.get('profit_factor'), (int, float)) and metrics_2025['trades'] > 0:
    if metrics_2025['profit_factor'] > 1.5:
        verdicts.append(f'✓ OOS 2025 PASS: PF={metrics_2025["profit_factor"]}, trades={metrics_2025["trades"]}')
    else:
        verdicts.append(f'⚠️ OOS 2025 WEAK: PF={metrics_2025["profit_factor"]}, trades={metrics_2025["trades"]}')

for v in verdicts:
    print(f'  {v}')
