#!/usr/bin/env python3
"""
V40-new vs V40-old vs V39.3-v3 Three-Way Comparison
Compares the new V40 (with partial_exit + trailing fix) against:
  - V39.3 v3 (baseline before V40)
  - V40-old (V40 without partial/trailing — saved in v40_vs_v393_v3_comparison.json)
"""
import json
import math
import os
from collections import Counter, defaultdict

V40_NEW_TRADES = '/home/z/my-project/vps-service/backtest_results/v40_backtest_egx_all_trades.json'
V40_NEW_SUMMARY = '/home/z/my-project/vps-service/backtest_results/v40_backtest_egx_all.json'
V40_OLD_COMPARISON = '/home/z/my-project/vps-service/backtest_results/v40_vs_v393_v3_comparison.json'
V393_V3_TRADES = '/home/z/my-project/vps-service/backtest_results/v393_backtest_egx_all_v3_trades.json'
V393_V3_SUMMARY = '/home/z/my-project/vps-service/backtest_results/v393_backtest_egx_all_v3.json'

def compute_stats(trades):
    total = len(trades)
    if total == 0:
        return {'total_trades': 0}
    winning = [t for t in trades if t.get('return_pct', 0) > 0]
    losing = [t for t in trades if t.get('return_pct', 0) <= 0]
    win_count = len(winning)
    lose_count = len(losing)
    win_rate = win_count / total * 100
    returns = [t.get('return_pct', 0) for t in trades]
    avg_return = sum(returns) / total
    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0
    avg_win = gross_profit / win_count if win_count > 0 else 0
    avg_loss = gross_loss / lose_count if lose_count > 0 else 0
    equity = [100.0]
    peak = 100.0
    max_dd = 0.0
    for r in returns:
        equity.append(equity[-1] * (1 + r / 100))
        peak = max(peak, equity[-1])
        dd = (peak - equity[-1]) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)
    holding = [t.get('holding_days', 0) for t in trades if t.get('holding_days', 0) > 0]
    avg_holding = sum(holding) / len(holding) if holding else 0
    exit_reasons = Counter(t.get('exit_reason', 'unknown') for t in trades)
    exit_pct = {k: round(v / total * 100, 2) for k, v in exit_reasons.items()}
    unique_tickers = len(set(t.get('ticker', '') for t in trades))
    dates = sorted(set(t.get('entry_date', '') for t in trades if t.get('entry_date')))
    if len(returns) > 1:
        avg_ret = sum(returns) / len(returns)
        variance = sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1)
        std_ret = math.sqrt(variance) if variance > 0 else 1.0
        sharpe = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0
    else:
        sharpe = 0
    # V40-new: partial_exit stats
    partial_trades = [t for t in trades if t.get('partial_exit_taken', False)]
    partial_count = len(partial_trades)
    partial_pct = round(partial_count / total * 100, 2) if total > 0 else 0
    partial_returns = [t.get('return_pct', 0) for t in partial_trades]
    partial_avg_ret = round(sum(partial_returns) / len(partial_returns), 2) if partial_returns else 0
    non_partial_returns = [t.get('return_pct', 0) for t in trades if not t.get('partial_exit_taken', False)]
    non_partial_avg_ret = round(sum(non_partial_returns) / len(non_partial_returns), 2) if non_partial_returns else 0
    return {
        'total_trades': total,
        'unique_tickers': unique_tickers,
        'win_rate': round(win_rate, 2),
        'profit_factor': round(profit_factor, 3),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'avg_return': round(avg_return, 2),
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'max_drawdown_pct': round(max_dd, 2),
        'sharpe_ratio': round(sharpe, 2),
        'avg_holding_days': round(avg_holding, 1),
        'exit_reasons': dict(exit_reasons),
        'exit_reasons_pct': exit_pct,
        'date_range': f"{dates[0] if dates else 'N/A'} → {dates[-1] if dates else 'N/A'}",
        'scan_dates': len(dates),
        'partial_exit_count': partial_count,
        'partial_exit_pct_of_trades': partial_pct,
        'partial_exit_avg_return': partial_avg_ret,
        'non_partial_avg_return': non_partial_avg_ret,
    }

def main():
    # Load V40-new (with partial/trailing)
    with open(V40_NEW_TRADES) as f:
        v40_new_trades = json.load(f)
    # Load V40-old comparison (has v40_same_period and v40_full)
    with open(V40_OLD_COMPARISON) as f:
        v40_old = json.load(f)
    # Load V39.3 v3
    with open(V393_V3_TRADES) as f:
        v393_v3_trades = json.load(f)

    # Filter V40-new to same period as V39.3 v3 (2026-02-01 to 2026-06-08)
    v40_new_same_period = [t for t in v40_new_trades if '2026-02-01' <= t.get('entry_date', '') <= '2026-06-08']

    # Compute stats
    v40_new_full = compute_stats(v40_new_trades)
    v40_new_sp = compute_stats(v40_new_same_period)
    v393_v3 = compute_stats(v393_v3_trades)

    # V40-old stats (from saved comparison)
    v40_old_sp = v40_old.get('v40_same_period', {})
    v40_old_full = v40_old.get('v40_full', {})

    # Print 3-way comparison (same period)
    print("=" * 110)
    print("THREE-WAY COMPARISON (same period: 2026-02-01 → 2026-06-08, 750 EGX tickers)")
    print("=" * 110)
    print(f"{'Metric':<28} {'V39.3 v3':>14} {'V40-old':>14} {'V40-new':>14} {'Δ(new-old)':>14} {'Δ(new-v393)':>14}")
    print("-" * 110)

    metrics = [
        ('Total trades', 'total_trades', 'int'),
        ('Unique tickers', 'unique_tickers', 'int'),
        ('Win rate %', 'win_rate', 'float'),
        ('Profit factor', 'profit_factor', 'float'),
        ('Avg win %', 'avg_win', 'float'),
        ('Avg loss %', 'avg_loss', 'float'),
        ('Avg return %', 'avg_return', 'float'),
        ('Gross profit', 'gross_profit', 'float'),
        ('Gross loss', 'gross_loss', 'float'),
        ('Max drawdown %', 'max_drawdown_pct', 'float'),
        ('Sharpe ratio', 'sharpe_ratio', 'float'),
        ('Avg holding days', 'avg_holding_days', 'float'),
    ]

    for label, key, typ in metrics:
        v3 = v393_v3.get(key, 0)
        old = v40_old_sp.get(key, 0)
        new = v40_new_sp.get(key, 0)
        d_old = new - old if isinstance(new, (int, float)) and isinstance(old, (int, float)) else 'N/A'
        d_v3 = new - v3 if isinstance(new, (int, float)) and isinstance(v3, (int, float)) else 'N/A'
        if typ == 'float':
            print(f"{label:<28} {v3:>14.2f} {old:>14.2f} {new:>14.2f} {d_old:>+14.2f} {d_v3:>+14.2f}")
        else:
            print(f"{label:<28} {v3:>14} {old:>14} {new:>14} {d_old:>+14} {d_v3:>+14}")

    # Exit reasons
    print("\n" + "-" * 110)
    print("EXIT REASONS DISTRIBUTION (same period)")
    print("-" * 110)
    print(f"{'Reason':<20} {'V39.3 v3':>14} {'V40-old':>14} {'V40-new':>14}")
    all_reasons = set()
    for d in [v393_v3.get('exit_reasons', {}), v40_old_sp.get('exit_reasons', {}), v40_new_sp.get('exit_reasons', {})]:
        all_reasons.update(d.keys())
    for reason in sorted(all_reasons):
        v3 = v393_v3.get('exit_reasons', {}).get(reason, 0)
        v3p = v393_v3.get('exit_reasons_pct', {}).get(reason, 0)
        old = v40_old_sp.get('exit_reasons', {}).get(reason, 0)
        oldp = v40_old_sp.get('exit_reasons_pct', {}).get(reason, 0)
        new = v40_new_sp.get('exit_reasons', {}).get(reason, 0)
        newp = v40_new_sp.get('exit_reasons_pct', {}).get(reason, 0)
        print(f"{reason:<20} {v3:>5} ({v3p:>5.1f}%) {old:>5} ({oldp:>5.1f}%) {new:>5} ({newp:>5.1f}%)")

    # V40-new partial exit stats (full period)
    print("\n" + "-" * 110)
    print("V40-NEW PARTIAL EXIT STATS (full period)")
    print("-" * 110)
    print(f"Trades with partial_exit:   {v40_new_full.get('partial_exit_count', 0)} / {v40_new_full.get('total_trades', 0)} ({v40_new_full.get('partial_exit_pct_of_trades', 0)}%)")
    print(f"Avg return (partial trades):     {v40_new_full.get('partial_exit_avg_return', 0):+.2f}%")
    print(f"Avg return (non-partial trades): {v40_new_full.get('non_partial_avg_return', 0):+.2f}%")

    # Full period comparison
    print("\n" + "=" * 110)
    print("V40-NEW FULL PERIOD (2025-06-01 → 2026-06-08)")
    print("=" * 110)
    print(f"{'Metric':<28} {'V40-old (full)':>16} {'V40-new (full)':>16} {'Δ':>14}")
    print("-" * 110)
    for label, key, typ in metrics:
        old = v40_old_full.get(key, 0)
        new = v40_new_full.get(key, 0)
        d = new - old if isinstance(new, (int, float)) and isinstance(old, (int, float)) else 'N/A'
        if typ == 'float':
            print(f"{label:<28} {old:>16.2f} {new:>16.2f} {d:>+14.2f}")
        else:
            print(f"{label:<28} {old:>16} {new:>16} {d:>+14}")

    # Save 3-way comparison
    report = {
        'v39_3_v3': v393_v3,
        'v40_old_same_period': v40_old_sp,
        'v40_new_same_period': v40_new_sp,
        'v40_old_full': v40_old_full,
        'v40_new_full': v40_new_full,
        'note': 'V40-new = simulate_trade updated with partial_exit + trailing stop reorder. V40-old = original simulate_trade (no partial, trailing rarely fired).',
    }
    report_path = '/home/z/my-project/vps-service/backtest_results/v40_new_vs_old_vs_v393_comparison.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 3-way comparison saved: {report_path}")

if __name__ == '__main__':
    main()
