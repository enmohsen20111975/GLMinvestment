#!/usr/bin/env python3
"""Merge V40.2 batch trades, recompute combined metrics with position sizing, compare to V40.1."""
import json
import os
from collections import defaultdict, Counter
from datetime import datetime

OUT_DIR = '/home/z/my-project/scratch/v40_2_backtest'
RESULTS_DIR = '/home/z/my-project/vps-service/backtest_results'

RISK_PCT = 1.5  # matches engine_settings risk_per_trade_pct

all_trades = []
for i in range(1, 7):
    p = f'{OUT_DIR}/batch_{i}_trades.json'
    if os.path.exists(p):
        with open(p) as f:
            all_trades.extend(json.load(f))

print(f"Total merged trades: {len(all_trades)}")

# Sort by entry_date then ticker for deterministic equity curve
all_trades.sort(key=lambda t: (t.get('entry_date', ''), t.get('ticker', '')))

# Recompute R-multiple and equity impact with position sizing (1.5% risk)
for t in all_trades:
    entry = t.get('entry_price', 0)
    stop = t.get('stop_loss', 0)
    ret = t.get('return_pct', 0)
    if entry > 0 and stop < entry and stop > 0:
        stop_dist = entry - stop
        t['r_multiple'] = (ret / 100.0) * (entry / stop_dist)
    else:
        t['r_multiple'] = 0.0
    t['pnl_pct'] = RISK_PCT * t['r_multiple']
    t['is_win'] = ret > 0

# Combined metrics
wins = [t for t in all_trades if t['is_win']]
losses = [t for t in all_trades if not t['is_win']]
gross_profit = sum(t['pnl_pct'] for t in wins)
gross_loss = abs(sum(t['pnl_pct'] for t in losses))
pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
wr = len(wins) / len(all_trades) * 100 if all_trades else 0
avg_win = sum(t['pnl_pct'] for t in wins) / len(wins) if wins else 0
avg_loss = abs(sum(t['pnl_pct'] for t in losses) / len(losses)) if losses else 0
avg_ret = sum(t['pnl_pct'] for t in all_trades) / len(all_trades) if all_trades else 0
avg_r = sum(t['r_multiple'] for t in all_trades) / len(all_trades) if all_trades else 0

# Equity curve (compounding, start=100)
equity = [100.0]
peak = 100.0
max_dd = 0.0
for t in all_trades:
    eq_change = t['pnl_pct'] / 100.0
    equity.append(equity[-1] * (1 + eq_change))
    peak = max(peak, equity[-1])
    dd = (peak - equity[-1]) / peak * 100 if peak > 0 else 0
    max_dd = max(max_dd, dd)

# Sharpe (per-trade, annualized by sqrt(252))
rets = [t['pnl_pct'] / 100.0 for t in all_trades]
if rets:
    mean_r = sum(rets) / len(rets)
    var = sum((r - mean_r) ** 2 for r in rets) / len(rets)
    std = var ** 0.5
    sharpe = (mean_r / std) * (252 ** 0.5) if std > 0 else 0
else:
    sharpe = 0

# Exit reasons
exit_reasons = Counter(t.get('exit_reason', '?') for t in all_trades)
# Evidence distribution
ev_dist = Counter()
for t in all_trades:
    proofs = t.get('proofs', {})
    ev = sum(1 for v in proofs.values() if '✅' in str(v)) if isinstance(proofs, dict) else 0
    ev_dist[ev] += 1
# Signal distribution
sig_dist = Counter(t.get('signal', '?') for t in all_trades)
# Unique tickers
unique_tickers = len(set(t.get('ticker', '') for t in all_trades))
# Date range
dates = sorted(set(t.get('entry_date', '') for t in all_trades))
date_range = f"{dates[0]} → {dates[-1]}" if dates else "n/a"

# Partial exit stats
partial_trades = [t for t in all_trades if t.get('partial_exit_taken')]
partial_avg = sum(t['return_pct'] for t in partial_trades) / len(partial_trades) if partial_trades else 0
nopartial_trades = [t for t in all_trades if not t.get('partial_exit_taken')]
nopartial_avg = sum(t['return_pct'] for t in nopartial_trades) / len(nopartial_trades) if nopartial_trades else 0

merged = {
    'version': 'V40.2 (tightened entry conditions + real benchmark + mapping fix + strict kill-filters)',
    'period': date_range,
    'scan_interval': 3,
    'risk_per_trade_pct': RISK_PCT,
    'total_trades': len(all_trades),
    'unique_tickers': unique_tickers,
    'win_rate': round(wr, 2),
    'profit_factor': round(pf, 3),
    'avg_win_pct': round(avg_win, 3),
    'avg_loss_pct': round(avg_loss, 3),
    'avg_return_pct': round(avg_ret, 4),
    'avg_r_multiple': round(avg_r, 4),
    'gross_profit': round(gross_profit, 2),
    'gross_loss': round(gross_loss, 2),
    'max_drawdown_pct': round(max_dd, 2),
    'sharpe_ratio': round(sharpe, 3),
    'final_equity': round(equity[-1], 2),
    'total_return_compound_pct': round(equity[-1] - 100, 2),
    'avg_holding_days': round(sum(t.get('holding_days', 0) for t in all_trades) / len(all_trades), 2) if all_trades else 0,
    'exit_reasons': dict(exit_reasons),
    'exit_reasons_pct': {k: round(v * 100 / len(all_trades), 2) for k, v in exit_reasons.items()},
    'by_evidence': {str(k): v for k, v in sorted(ev_dist.items())},
    'by_signal': dict(sig_dist),
    'partial_exit_stats': {
        'trades_with_partial': len(partial_trades),
        'pct_of_total': round(len(partial_trades) * 100 / len(all_trades), 1) if all_trades else 0,
        'avg_return_partial': round(partial_avg, 3),
        'avg_return_no_partial': round(nopartial_avg, 3),
    },
}

# Load V40.1 baseline for comparison
v401_path = f'{RESULTS_DIR}/v40_position_sizing_comparison.json'
v401_same = None
if os.path.exists(v401_path):
    with open(v401_path) as f:
        v401 = json.load(f)
    v401_same = v401.get('same_period', {}).get('with_position_sizing', {})

comparison = {
    'period': date_range,
    'v40_1_baseline': v401_same or {},
    'v40_2_tightened': merged,
    'delta': {},
}
if v401_same:
    for k in ['total_trades', 'win_rate', 'profit_factor', 'max_drawdown_pct', 'sharpe_ratio', 'avg_return_pct', 'avg_win_pct', 'avg_loss_pct']:
        old = v401_same.get(k)
        new = merged.get(k)
        if old is not None and new is not None and isinstance(old, (int, float)):
            comparison['delta'][k] = round(new - old, 3)

# Save
with open(f'{RESULTS_DIR}/v40_2_backtest_egx_all.json', 'w', encoding='utf-8') as f:
    json.dump(merged, f, indent=2, ensure_ascii=False, default=str)
with open(f'{RESULTS_DIR}/v40_2_backtest_egx_all_trades.json', 'w', encoding='utf-8') as f:
    json.dump(all_trades, f, ensure_ascii=False, default=str)
with open(f'{RESULTS_DIR}/v40_2_vs_v40_1_comparison.json', 'w', encoding='utf-8') as f:
    json.dump(comparison, f, indent=2, ensure_ascii=False, default=str)

# Print summary
print("\n" + "=" * 70)
print("  V40.2 BACKTEST RESULTS (same period: 2026-02-01 → 2026-06-08)")
print("=" * 70)
print(f"  Total trades:        {merged['total_trades']}")
print(f"  Unique tickers:      {merged['unique_tickers']}")
print(f"  Win Rate:            {merged['win_rate']}%")
print(f"  Profit Factor:       {merged['profit_factor']}")
print(f"  Avg Win:             +{merged['avg_win_pct']}%")
print(f"  Avg Loss:            -{merged['avg_loss_pct']}%")
print(f"  Avg Return:          {merged['avg_return_pct']}%")
print(f"  Avg R-multiple:      {merged['avg_r_multiple']}")
print(f"  Max Drawdown:        {merged['max_drawdown_pct']}%")
print(f"  Sharpe Ratio:        {merged['sharpe_ratio']}")
print(f"  Final Equity:        {merged['final_equity']} (start=100)")
print(f"  Total Return:        +{merged['total_return_compound_pct']}%")
print(f"  Avg Holding Days:    {merged['avg_holding_days']}")
print(f"  Exit reasons:        {merged['exit_reasons']}")
print(f"  Evidence dist:       {merged['by_evidence']}")
print(f"  Signal dist:         {merged['by_signal']}")
print(f"  Partial exit:        {merged['partial_exit_stats']['trades_with_partial']}/{merged['total_trades']} ({merged['partial_exit_stats']['pct_of_total']}%) — avg ret {merged['partial_exit_stats']['avg_return_partial']}% vs no-partial {merged['partial_exit_stats']['avg_return_no_partial']}%")

if v401_same:
    print("\n" + "=" * 70)
    print("  V40.2 vs V40.1 (same period)")
    print("=" * 70)
    print(f"  {'Metric':<22} {'V40.1':>12} {'V40.2':>12} {'Delta':>10}")
    for k in ['total_trades', 'win_rate', 'profit_factor', 'max_drawdown_pct', 'sharpe_ratio', 'avg_return_pct']:
        old = v401_same.get(k)
        new = merged.get(k)
        d = comparison['delta'].get(k, '')
        print(f"  {k:<22} {str(old):>12} {str(new):>12} {str(d):>10}")
