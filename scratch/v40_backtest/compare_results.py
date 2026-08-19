#!/usr/bin/env python3
"""
V40 vs V39.3-v3 Comparison
Compares V40 results filtered to the same date range as V39.3 v3
(2026-02-01 to 2026-06-08) for a fair comparison.
"""
import json
import math
import os
from collections import Counter, defaultdict

V40_TRADES_PATH = '/home/z/my-project/vps-service/backtest_results/v40_backtest_egx_all_trades.json'
V393_V3_PATH = '/home/z/my-project/vps-service/backtest_results/v393_backtest_egx_all_v3.json'
V393_V3_TRADES_PATH = '/home/z/my-project/vps-service/backtest_results/v393_backtest_egx_all_v3_trades.json'

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

    # Equity curve and max drawdown
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

    by_proof = Counter()
    for t in trades:
        proofs = t.get('proofs', {})
        count = sum(1 for v in proofs.values() if '✅' in str(v))
        by_proof[str(count)] += 1

    unique_tickers = len(set(t.get('ticker', '') for t in trades))
    dates = sorted(set(t.get('entry_date', '') for t in trades if t.get('entry_date')))

    # Sharpe
    if len(returns) > 1:
        avg_ret = sum(returns) / len(returns)
        variance = sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1)
        std_ret = math.sqrt(variance) if variance > 0 else 1.0
        sharpe = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0
    else:
        sharpe = 0

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
        'by_proof_count': dict(by_proof),
        'date_range': f"{dates[0] if dates else 'N/A'} → {dates[-1] if dates else 'N/A'}",
        'scan_dates': len(dates),
    }

def main():
    # Load V40 trades
    with open(V40_TRADES_PATH) as f:
        v40_trades = json.load(f)

    # Load V39.3 v3 summary
    with open(V393_V3_PATH) as f:
        v393_v3 = json.load(f)

    # Load V39.3 v3 trades
    with open(V393_V3_TRADES_PATH) as f:
        v393_v3_trades = json.load(f)

    # Filter V40 to same date range as V39.3 v3 (2026-02-01 to 2026-06-08)
    v40_filtered = [t for t in v40_trades if '2026-02-01' <= t.get('entry_date', '') <= '2026-06-08']

    # Compute stats
    v40_full = compute_stats(v40_trades)
    v40_same_period = compute_stats(v40_filtered)
    v393_v3_stats = compute_stats(v393_v3_trades)

    # Also compute V39.3 v3 stats from summary (for cross-check)
    v393_v3_summary = {
        'total_trades': v393_v3.get('total_trades', 0),
        'unique_tickers': len(set(t.get('ticker', '') for t in v393_v3_trades)),
        'win_rate': round(v393_v3.get('win_rate', 0), 2),
        'profit_factor': round(v393_v3.get('profit_factor', 0), 3),
        'avg_return': round(v393_v3.get('avg_return', 0), 2),
        'gross_profit': round(v393_v3.get('gross_profit', 0), 2),
        'gross_loss': round(v393_v3.get('gross_loss', 0), 2),
        'max_drawdown_pct': round(v393_v3.get('max_drawdown_pct', 0), 2),
        'sharpe_ratio': round(v393_v3.get('sharpe_ratio', 0), 2),
        'avg_holding_days': round(v393_v3.get('avg_holding_days', 0), 1),
        'exit_reasons': {'hit_stop': 1091, 'hit_target': 839, 'expired': 218},
        'exit_reasons_pct': {'hit_stop': 50.79, 'hit_target': 39.06, 'expired': 10.15},
        'by_proof_count': v393_v3.get('by_proof_count', {}),
        'date_range': '2026-02-01 → 2026-06-08',
        'scan_dates': 19,
    }

    # Print comparison table
    print("=" * 90)
    print("V40 vs V39.3-v3 COMPARISON (EGX, 750 tickers tested)")
    print("=" * 90)
    print(f"{'Metric':<28} {'V39.3 v3':>16} {'V40 (same period)':>20} {'V40 (full)':>16}")
    print("-" * 90)

    metrics = [
        ('Date range', 'date_range', 'str'),
        ('Scan dates', 'scan_dates', 'int'),
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
        v3_val = v393_v3_stats.get(key, 'N/A')
        v40_sp = v40_same_period.get(key, 'N/A')
        v40_f = v40_full.get(key, 'N/A')
        if typ == 'float' and isinstance(v3_val, (int, float)):
            print(f"{label:<28} {v3_val:>16.2f} {v40_sp:>20.2f} {v40_f:>16.2f}")
        elif typ == 'int':
            print(f"{label:<28} {v3_val:>16} {v40_sp:>20} {v40_f:>16}")
        else:
            print(f"{label:<28} {str(v3_val):>16} {str(v40_sp):>20} {str(v40_f):>16}")

    print("\n" + "-" * 90)
    print("EXIT REASONS DISTRIBUTION")
    print("-" * 90)
    print(f"{'Reason':<20} {'V39.3 v3':>20} {'V40 (same period)':>25} {'V40 (full)':>20}")
    all_reasons = set()
    for d in [v393_v3_stats.get('exit_reasons', {}), v40_same_period.get('exit_reasons', {}), v40_full.get('exit_reasons', {})]:
        all_reasons.update(d.keys())
    for reason in sorted(all_reasons):
        v3 = v393_v3_stats.get('exit_reasons', {}).get(reason, 0)
        v3p = v393_v3_stats.get('exit_reasons_pct', {}).get(reason, 0)
        v40s = v40_same_period.get('exit_reasons', {}).get(reason, 0)
        v40sp = v40_same_period.get('exit_reasons_pct', {}).get(reason, 0)
        v40f = v40_full.get('exit_reasons', {}).get(reason, 0)
        v40fp = v40_full.get('exit_reasons_pct', {}).get(reason, 0)
        print(f"{reason:<20} {v3:>8} ({v3p:>5.1f}%) {v40s:>10} ({v40sp:>5.1f}%) {v40f:>8} ({v40fp:>5.1f}%)")

    print("\n" + "-" * 90)
    print("PROOF COUNT DISTRIBUTION")
    print("-" * 90)
    print(f"{'Proofs':<20} {'V39.3 v3':>20} {'V40 (same period)':>25} {'V40 (full)':>20}")
    all_proofs = set()
    for d in [v393_v3_stats.get('by_proof_count', {}), v40_same_period.get('by_proof_count', {}), v40_full.get('by_proof_count', {})]:
        all_proofs.update(d.keys())
    for proof in sorted(all_proofs):
        v3 = v393_v3_stats.get('by_proof_count', {}).get(proof, 0)
        v40s = v40_same_period.get('by_proof_count', {}).get(proof, 0)
        v40f = v40_full.get('by_proof_count', {}).get(proof, 0)
        print(f"{proof:<20} {v3:>20} {v40s:>25} {v40f:>20}")

    # Save comparison report
    report = {
        'v39_3_v3': v393_v3_stats,
        'v40_same_period': v40_same_period,
        'v40_full': v40_full,
        'note': 'V40 same period = V40 trades filtered to 2026-02-01..2026-06-08 (matching V39.3 v3). V40 full = all V40 trades 2025-06-01..2026-06-08.',
    }
    report_path = '/home/z/my-project/vps-service/backtest_results/v40_vs_v393_v3_comparison.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Comparison report saved: {report_path}")

if __name__ == '__main__':
    main()
