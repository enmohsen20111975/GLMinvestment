#!/usr/bin/env python3
"""
phase1_5_metrics.py — Calculate missing metrics from Phase 1 baseline
=====================================================================

Reads the 422 signals from Phase 1, calculates:
- Avg Win / Avg Loss
- Profit Factor
- Max Drawdown
- Sharpe Ratio
- R-multiple
- Exit type distribution
- Longest losing streak

No new backtest — just metrics on existing data.
"""
from __future__ import annotations

import os, sys, json, math, sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

TRAIN_START = '2025-07-01'
TRAIN_END = '2026-03-31'
MAX_TICKERS = 100
TARGET_PCT = 10.0  # default target +10%
STOP_PCT = 7.0     # default stop -7%
HOLDING_DAYS = 30


def main():
    print(f"\n{'='*70}")
    print(f"  Phase 1.5: Missing Metrics Calculation")
    print(f"  Period: {TRAIN_START} → {TRAIN_END}")
    print(f"  Target: +{TARGET_PCT}% | Stop: -{STOP_PCT}% | Hold: {HOLDING_DAYS}d")
    print(f"{'='*70}\n")

    # Load V38 engine + generate signals (same as Phase 1)
    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history

    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()

    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= '2025-06-01' AND date <= ?
        AND ticker NOT LIKE '%.%'
        ORDER BY ticker LIMIT ?
    """, (TRAIN_END, MAX_TICKERS)).fetchall()]
    
    # Get all dates
    dates = [r[0] for r in conn.execute("""
        SELECT DISTINCT date FROM price_history
        WHERE date >= ? AND date <= ?
        ORDER BY date ASC
    """, (TRAIN_START, TRAIN_END)).fetchall()]
    conn.close()

    print(f"  Tickers: {len(tickers)} | Trading days: {len(dates)}")
    
    pre_cache_price_history(tickers, engine)

    # Generate signals + compute exits
    trades = []
    processed = 0

    for ticker in tickers:
        processed += 1
        if processed % 20 == 0:
            print(f"  Processing {processed}/{len(tickers)}...")

        dates_t, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < 50:
            continue

        for i in range(50, len(closes)):
            if dates_t[i] < TRAIN_START or dates_t[i] > TRAIN_END:
                continue

            try:
                result = engine.analyze_single_day(ticker, dates_t, opens, highs, lows, closes, volumes, i)
                signal = result.get('signal', 'WAIT')

                if signal not in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    continue

                entry_price = result.get('entry_price', closes[i])
                target_price = result.get('target_price') or entry_price * (1 + TARGET_PCT / 100)
                stop_price = result.get('stop_loss') or entry_price * (1 - STOP_PCT / 100)

                # Find exit
                exit_price = None
                exit_type = 'EXPIRED'
                exit_day = 0

                for j in range(i + 1, min(i + 1 + HOLDING_DAYS, len(closes))):
                    exit_day += 1
                    if lows[j] is not None and stop_price is not None and lows[j] <= stop_price:
                        exit_price = stop_price
                        exit_type = 'STOPPED'
                        break
                    if highs[j] is not None and target_price is not None and highs[j] >= target_price:
                        exit_price = target_price
                        exit_type = 'TARGET_HIT'
                        break

                if exit_price is None:
                    exit_price = closes[min(i + HOLDING_DAYS, len(closes) - 1)]

                return_pct = (exit_price / entry_price - 1) * 100
                risk = entry_price - stop_price
                reward = target_price - entry_price
                r_multiple = return_pct / (STOP_PCT) if STOP_PCT > 0 else 0

                trades.append({
                    'date': dates_t[i],
                    'ticker': ticker,
                    'signal': signal,
                    'entry': entry_price,
                    'exit': exit_price,
                    'target': target_price,
                    'stop': stop_price,
                    'return_pct': round(return_pct, 2),
                    'exit_type': exit_type,
                    'holding_days': exit_day,
                    'r_multiple': round(r_multiple, 2),
                })

            except Exception:
                pass

    print(f"\n  Total trades: {len(trades)}")

    if not trades:
        print("  ❌ No trades to analyze")
        return 1

    # ─── Calculate Metrics ───
    wins = [t for t in trades if t['exit_type'] == 'TARGET_HIT']
    losses = [t for t in trades if t['exit_type'] == 'STOPPED']
    expired = [t for t in trades if t['exit_type'] == 'EXPIRED']

    total = len(trades)
    win_count = len(wins)
    loss_count = len(losses)
    expired_count = len(expired)

    win_rate = win_count / total * 100 if total > 0 else 0

    # Avg win/loss
    avg_win = sum(t['return_pct'] for t in wins) / win_count if win_count > 0 else 0
    avg_loss = abs(sum(t['return_pct'] for t in losses) / loss_count) if loss_count > 0 else 0
    avg_return = sum(t['return_pct'] for t in trades) / total

    # Profit Factor
    gross_profit = sum(t['return_pct'] for t in trades if t['return_pct'] > 0)
    gross_loss = abs(sum(t['return_pct'] for t in trades if t['return_pct'] < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else 0

    # R-multiple
    avg_r = sum(t['r_multiple'] for t in trades) / total

    # Max Drawdown (equity curve)
    equity = 100000  # starting capital
    peak = equity
    max_dd = 0
    for t in trades:
        pnl = equity * (t['return_pct'] / 100)
        equity += pnl
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100
        max_dd = max(max_dd, dd)

    # Sharpe Ratio (annualized, risk-free = 20% EGX)
    returns = [t['return_pct'] for t in trades]
    if len(returns) > 1:
        avg_ret = sum(returns) / len(returns)
        std_ret = math.sqrt(sum((r - avg_ret) ** 2 for r in returns) / (len(returns) - 1))
        # Annualize: ~196 trading days, ~2.2 trades/day → ~422 trades/year
        trades_per_year = total / (len(dates) / 252) if len(dates) > 0 else total
        sharpe = (avg_ret - (20 / max(1, trades_per_year))) / std_ret * math.sqrt(trades_per_year) if std_ret > 0 else 0
    else:
        sharpe = 0

    # Longest losing streak
    streak = 0
    max_streak = 0
    for t in trades:
        if t['return_pct'] < 0:
            streak += 1
            max_streak = max(max_streak, streak)
        else:
            streak = 0

    # Exit type distribution
    target_pct = win_count / total * 100
    stop_pct = loss_count / total * 100
    expired_pct = expired_count / total * 100

    # Avg holding days
    avg_hold = sum(t['holding_days'] for t in trades) / total

    # ─── Print Results ───
    print(f"\n{'='*70}")
    print(f"  📊 PHASE 1.5 — COMPLETE METRICS")
    print(f"{'='*70}\n")

    print(f"  | {'Metric':<30} | {'Value':>12} |")
    print(f"  |{'─'*32}|{'─'*14}|")

    metrics = [
        ('Total Signals', f'{total}'),
        ('Wins (TARGET_HIT)', f'{win_count} ({target_pct:.1f}%)'),
        ('Losses (STOPPED)', f'{loss_count} ({stop_pct:.1f}%)'),
        ('Expired', f'{expired_count} ({expired_pct:.1f}%)'),
        ('Win Rate', f'{win_rate:.1f}%'),
        ('Avg Win', f'+{avg_win:.2f}%'),
        ('Avg Loss', f'-{avg_loss:.2f}%'),
        ('Profit Factor', f'{profit_factor:.2f}'),
        ('Avg Return per Trade', f'{avg_return:+.2f}%'),
        ('Avg R-multiple', f'{avg_r:.2f}R'),
        ('Max Drawdown', f'-{max_dd:.1f}%'),
        ('Sharpe Ratio', f'{sharpe:.2f}'),
        ('Avg Holding Days', f'{avg_hold:.1f}'),
        ('Longest Losing Streak', f'{max_streak}'),
        ('Gross Profit', f'+{gross_profit:.2f}%'),
        ('Gross Loss', f'-{gross_loss:.2f}%'),
    ]

    for name, value in metrics:
        print(f"  | {name:<30} | {value:>12} |")

    # Go/No-Go
    print(f"\n{'='*70}")
    if profit_factor >= 1.5 and max_dd < 20:
        print(f"  🟢 EXCELLENT — PF={profit_factor:.2f}, MaxDD=-{max_dd:.1f}%")
        print(f"  → Proceed to Phase 5 (Shadow Mode) + deploy after 1 week")
    elif profit_factor >= 1.3 and max_dd < 25:
        print(f"  🟡 ACCEPTABLE — PF={profit_factor:.2f}, MaxDD=-{max_dd:.1f}%")
        print(f"  → Proceed to Phase 2 (engine improvement)")
    elif profit_factor >= 1.0:
        print(f"  🟠 MARGINAL — PF={profit_factor:.2f}, MaxDD=-{max_dd:.1f}%")
        print(f"  → V38 needs threshold tuning before deploy")
    else:
        print(f"  🔴 LOSING — PF={profit_factor:.2f}, MaxDD=-{max_dd:.1f}%")
        print(f"  → V38 needs fundamental redesign")
    print(f"{'='*70}\n")

    # Save JSON
    output = {
        'timestamp': datetime.now().isoformat(),
        'period': f'{TRAIN_START} → {TRAIN_END}',
        'total_signals': total,
        'wins': win_count,
        'losses': loss_count,
        'expired': expired_count,
        'win_rate': round(win_rate, 1),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2),
        'avg_return': round(avg_return, 2),
        'avg_r_multiple': round(avg_r, 2),
        'max_drawdown': round(max_dd, 1),
        'sharpe_ratio': round(sharpe, 2),
        'avg_holding_days': round(avg_hold, 1),
        'longest_losing_streak': max_streak,
        'gross_profit': round(gross_profit, 2),
        'gross_loss': round(gross_loss, 2),
        'exit_distribution': {
            'target_hit': f'{target_pct:.1f}%',
            'stopped': f'{stop_pct:.1f}%',
            'expired': f'{expired_pct:.1f}%',
        },
    }

    output_dir = PROJECT_ROOT / 'scripts' / 'baseline_data'
    output_dir.mkdir(exist_ok=True)
    output_path = output_dir / f'phase1_5_metrics_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(output_path, 'w') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    # Save markdown
    doc_path = PROJECT_ROOT / 'Documentation' / 'PHASE1.5-METRICS.md'
    with open(doc_path, 'w') as f:
        f.write(f"# Phase 1.5 — Complete V38 Metrics\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"| Metric | Value |\n")
        f.write(f"|--------|-------|\n")
        for name, value in metrics:
            f.write(f"| {name} | {value} |\n")
        f.write(f"\n## Exit Type Distribution\n\n")
        f.write(f"- TARGET_HIT: {target_pct:.1f}%\n")
        f.write(f"- STOPPED: {stop_pct:.1f}%\n")
        f.write(f"- EXPIRED: {expired_pct:.1f}%\n")

    print(f"  💾 JSON: {output_path}")
    print(f"  📄 Report: {doc_path}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
