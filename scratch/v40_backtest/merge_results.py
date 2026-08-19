#!/usr/bin/env python3
"""
V40 Backtest Results Merger
Merges trades from all batches and computes summary statistics
comparable to V39.3 v3 baseline.
"""
import json
import math
import os
from collections import Counter, defaultdict
from datetime import datetime

BATCH_DIR = '/home/z/my-project/scratch/v40_backtest'
OUTPUT_DIR = '/home/z/my-project/vps-service/backtest_results'

def load_all_trades():
    all_trades = []
    for i in range(1, 7):
        path = os.path.join(BATCH_DIR, f'batch_{i}_trades.json')
        with open(path) as f:
            trades = json.load(f)
        all_trades.extend(trades)
        print(f"Batch {i}: {len(trades)} trades")
    print(f"Total trades: {len(all_trades)}")
    return all_trades

def compute_summary(trades):
    # Sort by ticker then entry_date (same order as engine processes)
    trades_sorted = sorted(trades, key=lambda t: (t.get('ticker', ''), t.get('entry_date', '')))

    total_trades = len(trades_sorted)
    winning = [t for t in trades_sorted if t.get('is_win', False) or t.get('return_pct', 0) > 0]
    losing = [t for t in trades_sorted if not (t.get('is_win', False) or t.get('return_pct', 0) > 0)]

    win_count = len(winning)
    lose_count = len(losing)
    win_rate = (win_count / total_trades * 100) if total_trades > 0 else 0

    returns = [t.get('return_pct', 0) for t in trades_sorted]
    avg_return = sum(returns) / len(returns) if returns else 0
    total_return = sum(returns)

    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else (999.0 if gross_profit > 0 else 0.0)

    avg_win = (gross_profit / win_count) if win_count > 0 else 0
    avg_loss = (gross_loss / lose_count) if lose_count > 0 else 0

    # Equity curve and max drawdown (sequential, same as engine)
    equity = [100.0]
    peak = 100.0
    max_dd = 0.0
    for r in returns:
        equity_change = r / 100
        equity.append(equity[-1] * (1 + equity_change))
        peak = max(peak, equity[-1])
        dd = (peak - equity[-1]) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)

    # Holding days
    holding_days = [t.get('holding_days', 0) for t in trades_sorted if t.get('holding_days', 0) > 0]
    avg_holding = sum(holding_days) / len(holding_days) if holding_days else 0

    # R/R
    rr_values = []
    for t in trades_sorted:
        entry = t.get('entry_price', 0)
        sl = t.get('stop_loss', 0)
        target = t.get('target_price', 0)
        risk = entry - sl
        reward = target - entry
        if risk > 0:
            rr_values.append(reward / risk)
    avg_rr = sum(rr_values) / len(rr_values) if rr_values else 0

    # Sharpe
    if len(returns) > 1:
        avg_ret = sum(returns) / len(returns)
        variance = sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1)
        std_ret = math.sqrt(variance) if variance > 0 else 1.0
        sharpe = (avg_ret / std_ret) * math.sqrt(252) if std_ret > 0 else 0
    else:
        sharpe = 0

    # Calmar
    calmar = 0
    if max_dd > 0:
        annual_return = avg_return * 252 / (avg_holding if avg_holding > 0 else 1)
        calmar = annual_return / max_dd

    # Consecutive wins/losses
    max_cons_wins = 0
    max_cons_losses = 0
    cur_wins = 0
    cur_losses = 0
    for t in trades_sorted:
        if t.get('return_pct', 0) > 0:
            cur_wins += 1
            cur_losses = 0
            max_cons_wins = max(max_cons_wins, cur_wins)
        else:
            cur_losses += 1
            cur_wins = 0
            max_cons_losses = max(max_cons_losses, cur_losses)

    # By signal
    by_signal = Counter(t.get('signal', 'UNKNOWN') for t in trades_sorted)

    # By proof count
    by_proof = Counter()
    for t in trades_sorted:
        proofs = t.get('proofs', {})
        count = sum(1 for v in proofs.values() if '✅' in str(v))
        by_proof[count] += 1

    # Exit reasons
    exit_reasons = Counter(t.get('exit_reason', 'unknown') for t in trades_sorted)

    # Monthly returns
    monthly = defaultdict(float)
    for t in trades_sorted:
        date = t.get('entry_date', '')
        if date:
            month = date[:7]
            monthly[month] += t.get('return_pct', 0)

    # Top winners/losers
    sorted_by_ret = sorted(trades_sorted, key=lambda t: t.get('return_pct', 0), reverse=True)
    top_winners = [
        {'ticker': t.get('ticker'), 'date': t.get('entry_date'),
         'return_pct': round(t.get('return_pct', 0), 2),
         'signal': t.get('signal'), 'score': t.get('score', 0),
         'holding_days': t.get('holding_days', 0),
         'exit_reason': t.get('exit_reason')}
        for t in sorted_by_ret[:10]
    ]
    top_losers = [
        {'ticker': t.get('ticker'), 'date': t.get('entry_date'),
         'return_pct': round(t.get('return_pct', 0), 2),
         'signal': t.get('signal'), 'score': t.get('score', 0),
         'holding_days': t.get('holding_days', 0),
         'exit_reason': t.get('exit_reason')}
        for t in sorted_by_ret[-10:]
    ]

    # Unique tickers
    unique_tickers = len(set(t.get('ticker', '') for t in trades_sorted))

    # Date range
    dates = sorted(set(t.get('entry_date', '') for t in trades_sorted if t.get('entry_date')))

    # Model quality
    if total_trades == 0:
        quality = 'NO_TRADES'; quality_ar = '⏳ لا توجد صفقات'
    elif win_rate >= 60 and profit_factor > 1.2:
        quality = 'EXCELLENT'; quality_ar = '✅ النموذج دقيق ومتأكد'
    elif win_rate >= 50 and profit_factor > 1.0:
        quality = 'GOOD'; quality_ar = '🟡 النموذج مقبول — يحتاج ضبط'
    elif win_rate >= 40:
        quality = 'FAIR'; quality_ar = '🟠 النموذج ضعيف — يحتاج تحسين'
    else:
        quality = 'POOR'; quality_ar = '🔴 النموذج فاشل — إعادة تصميم'

    return {
        'total_tickers_tested': 750,
        'unique_tickers_with_trades': unique_tickers,
        'total_signals': total_trades,
        'total_trades': total_trades,
        'winning_trades': win_count,
        'losing_trades': lose_count,
        'win_rate': win_rate,
        'avg_return': avg_return,
        'total_return_pct': total_return,
        'gross_profit': gross_profit,
        'gross_loss': gross_loss,
        'profit_factor': profit_factor,
        'avg_win': avg_win,
        'avg_loss': avg_loss,
        'avg_holding_days': avg_holding,
        'avg_risk_reward': avg_rr,
        'max_consecutive_wins': max_cons_wins,
        'max_consecutive_losses': max_cons_losses,
        'sharpe_ratio': sharpe,
        'calmar_ratio': calmar,
        'max_drawdown_pct': max_dd,
        'by_signal': dict(by_signal),
        'by_proof_count': {str(k): v for k, v in by_proof.items()},
        'exit_reasons': dict(exit_reasons),
        'exit_reasons_pct': {k: round(v / total_trades * 100, 2) for k, v in exit_reasons.items()},
        'monthly_returns': dict(monthly),
        'top_winners': top_winners,
        'top_losers': top_losers,
        'date_range': {'start': dates[0] if dates else '', 'end': dates[-1] if dates else '', 'scan_dates': len(dates)},
        'model_quality': quality,
        'model_quality_ar': quality_ar,
        'version': 'V40-EVIDENCE-BASED',
        'generated_at': datetime.now().isoformat(),
    }

if __name__ == '__main__':
    trades = load_all_trades()
    summary = compute_summary(trades)

    # Save merged summary
    summary_path = os.path.join(OUTPUT_DIR, 'v40_backtest_egx_all.json')
    with open(summary_path, 'w', encoding='utf-8') as f:
        json.dump(summary, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 Summary saved: {summary_path}")

    # Save merged trades
    trades_path = os.path.join(OUTPUT_DIR, 'v40_backtest_egx_all_trades.json')
    with open(trades_path, 'w', encoding='utf-8') as f:
        json.dump(trades, f, ensure_ascii=False, default=str)
    print(f"💾 Trades saved: {trades_path}")

    # Print summary
    print("\n" + "=" * 70)
    print("V40 BACKTEST SUMMARY (EGX, 750 tickers)")
    print("=" * 70)
    print(f"Total trades:           {summary['total_trades']}")
    print(f"Unique tickers:         {summary['unique_tickers_with_trades']}")
    print(f"Win rate:               {summary['win_rate']:.2f}%")
    print(f"Profit factor:          {summary['profit_factor']:.2f}")
    print(f"Avg win:                +{summary['avg_win']:.2f}%")
    print(f"Avg loss:               -{summary['avg_loss']:.2f}%")
    print(f"Max drawdown:           {summary['max_drawdown_pct']:.2f}%")
    print(f"Sharpe ratio:           {summary['sharpe_ratio']:.2f}")
    print(f"Avg holding days:       {summary['avg_holding_days']:.1f}")
    print(f"Avg R/R:                {summary['avg_risk_reward']:.2f}")
    print(f"Max consecutive wins:   {summary['max_consecutive_wins']}")
    print(f"Max consecutive losses: {summary['max_consecutive_losses']}")
    print(f"\nBy signal:              {summary['by_signal']}")
    print(f"By proof count:         {summary['by_proof_count']}")
    print(f"Exit reasons:           {summary['exit_reasons']}")
    print(f"Exit reasons %:         {summary['exit_reasons_pct']}")
    print(f"Date range:             {summary['date_range']['start']} → {summary['date_range']['end']} ({summary['date_range']['scan_dates']} scan dates)")
    print(f"Monthly returns:        {summary['monthly_returns']}")
    print(f"\nModel quality:          {summary['model_quality']} — {summary['model_quality_ar']}")
