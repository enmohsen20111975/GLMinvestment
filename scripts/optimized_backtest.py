#!/usr/bin/env python3
"""
Optimized Backtest — اختبار محرك التحسين الجديد
===================================================
يستخدم PredictionOptimizer (mean-reversion + conviction filter + regime gate)
ويقارن النتائج مع baseline (41.3%) و improved (46.9%).

الهدف: الوصول لـ 60%+ win rate.
"""

import sqlite3
import json
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

from analyzers.prediction_optimizer import PredictionOptimizer

SAMPLE_SIZE = 50
SIM_DAYS = 60
MAX_HOLDING = 20
MIN_HISTORY = 100


def simulate_prediction(prices_after, entry, target, stop, signal, max_holding=MAX_HOLDING):
    """محاكاة ما يحدث بعد التوقع."""
    if signal == 'HOLD' or len(prices_after) == 0:
        return ('HOLD', 0, 0)

    for i, price in enumerate(prices_after[:max_holding]):
        if signal == 'BUY':
            if price >= target:
                return ('TARGET_HIT', (target - entry) / entry * 100, i + 1)
            if price <= stop:
                return ('STOPPED', (stop - entry) / entry * 100, i + 1)
        else:  # SELL
            if price <= target:
                return ('TARGET_HIT', (entry - target) / entry * 100, i + 1)
            if price >= stop:
                return ('STOPPED', (entry - stop) / entry * 100, i + 1)

    # Expired — use last price
    last = prices_after[min(max_holding - 1, len(prices_after) - 1)]
    if signal == 'BUY':
        ret = (last - entry) / entry * 100
    else:
        ret = (entry - last) / entry * 100
    return ('EXPIRED', ret, max_holding)


def run_optimized_backtest():
    print(f"\n{'#'*70}")
    print(f"# 📊 Optimized Backtest — PredictionOptimizer (Mean-Reversion)")
    print(f"# Sample: {SAMPLE_SIZE} stocks | Sim days: {SIM_DAYS} | Max hold: {MAX_HOLDING}")
    print(f"{'#'*70}")

    conn = sqlite3.connect(PRICE_HISTORY_DB)
    stocks = conn.execute("""
        SELECT ticker, COUNT(*) as cnt
        FROM price_history
        GROUP BY ticker
        HAVING cnt >= ?
        ORDER BY cnt DESC
        LIMIT ?
    """, (MIN_HISTORY + SIM_DAYS + MAX_HOLDING, SAMPLE_SIZE)).fetchall()

    print(f"\nFound {len(stocks)} stocks with sufficient history")

    engine = PredictionOptimizer()
    all_trades = []
    skipped_count = 0

    for stock_ticker, _ in stocks:
        rows = conn.execute("""
            SELECT date, close_price, high_price, low_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY date ASC
        """, (stock_ticker,)).fetchall()

        if len(rows) < MIN_HISTORY + SIM_DAYS + MAX_HOLDING:
            continue

        prices = [r[1] for r in rows]
        highs = [r[2] or r[1] for r in rows]
        lows = [r[3] or r[1] for r in rows]
        volumes = [r[4] or 0 for r in rows]

        for sim_day in range(SIM_DAYS):
            entry_idx = len(prices) - SIM_DAYS - MAX_HOLDING + sim_day
            if entry_idx < MIN_HISTORY:
                continue
            if entry_idx + MAX_HOLDING >= len(prices):
                continue

            hist_prices = prices[:entry_idx + 1]
            hist_highs = highs[:entry_idx + 1]
            hist_lows = lows[:entry_idx + 1]
            hist_volumes = volumes[:entry_idx + 1]
            future_prices = prices[entry_idx + 1:]

            # Use PredictionOptimizer
            result = engine.analyze(hist_prices, hist_highs, hist_lows, hist_volumes, ticker=stock_ticker)

            if result.signal == 'HOLD':
                skipped_count += 1
                continue

            outcome, ret, holding = simulate_prediction(
                future_prices, result.entry, result.target, result.stop, result.signal
            )

            all_trades.append({
                'ticker': stock_ticker,
                'signal': result.signal,
                'score': result.score,
                'entry': result.entry,
                'target': result.target,
                'stop': result.stop,
                'rr': result.risk_reward,
                'regime': result.regime,
                'conviction': len(result.conviction_factors),
                'outcome': outcome,
                'return': ret,
                'holding': holding,
            })

    conn.close()

    if not all_trades:
        print("\n⚠ No trades generated — all skipped!")
        print(f"   Skipped: {skipped_count}")
        return

    # Calculate metrics
    total = len(all_trades)
    wins = sum(1 for t in all_trades if t['return'] > 0)
    losses = total - wins
    win_rate = wins / total * 100

    returns = [t['return'] for t in all_trades]
    avg_return = sum(returns) / len(returns)
    avg_win = sum(r for r in returns if r > 0) / max(1, sum(1 for r in returns if r > 0))
    avg_loss = sum(r for r in returns if r < 0) / max(1, sum(1 for r in returns if r < 0))

    gross_profit = sum(r for r in returns if r > 0)
    gross_loss = abs(sum(r for r in returns if r < 0))
    profit_factor = gross_profit / gross_loss if gross_loss > 0 else float('inf')

    avg_holding = sum(t['holding'] for t in all_trades) / total

    # By outcome
    outcomes = {}
    for t in all_trades:
        outcomes[t['outcome']] = outcomes.get(t['outcome'], 0) + 1

    # By signal
    by_signal = {}
    for t in all_trades:
        sig = t['signal']
        if sig not in by_signal:
            by_signal[sig] = {'total': 0, 'wins': 0, 'returns': []}
        by_signal[sig]['total'] += 1
        if t['return'] > 0:
            by_signal[sig]['wins'] += 1
        by_signal[sig]['returns'].append(t['return'])

    # By regime
    by_regime = {}
    for t in all_trades:
        reg = t['regime']
        if reg not in by_regime:
            by_regime[reg] = {'total': 0, 'wins': 0, 'returns': []}
        by_regime[reg]['total'] += 1
        if t['return'] > 0:
            by_regime[reg]['wins'] += 1
        by_regime[reg]['returns'].append(t['return'])

    # By conviction level
    by_conviction = {}
    for t in all_trades:
        c = t['conviction']
        bucket = f'{c}+'
        if bucket not in by_conviction:
            by_conviction[bucket] = {'total': 0, 'wins': 0, 'returns': []}
        by_conviction[bucket]['total'] += 1
        if t['return'] > 0:
            by_conviction[bucket]['wins'] += 1
        by_conviction[bucket]['returns'].append(t['return'])

    # Print results
    print(f"\n{'='*60}")
    print(f"📊 النتائج (Optimized — Mean-Reversion)")
    print(f"{'='*60}")
    print(f"\n  Total trades: {total} (skipped: {skipped_count})")
    print(f"  Wins: {wins} | Losses: {losses}")
    print(f"  Win Rate: {win_rate:.1f}%")
    print(f"  Avg Return: {avg_return:.2f}%")
    print(f"  Avg Win: +{avg_win:.2f}%")
    print(f"  Avg Loss: {avg_loss:.2f}%")
    print(f"  Profit Factor: {profit_factor:.2f}")
    print(f"  Avg Holding: {avg_holding:.1f} days")

    # Compare with baseline + improved
    print(f"\n{'='*60}")
    print(f"📈 المقارنة الكاملة")
    print(f"{'='*60}")
    baseline = json.load(open(PROJECT_ROOT / 'scripts' / 'baseline_results.json'))
    improved = json.load(open(PROJECT_ROOT / 'scripts' / 'improved_results.json'))

    print(f"\n  {'Metric':<20} {'Baseline':>10} {'Track2+3':>10} {'Optimized':>10} {'Total Δ':>10}")
    print(f"  {'-'*60}")
    print(f"  {'Win Rate':<20} {baseline['win_rate']:>9.1f}% {improved['win_rate']:>9.1f}% {win_rate:>9.1f}% {win_rate - baseline['win_rate']:>+9.1f}%")
    print(f"  {'Avg Return':<20} {baseline['avg_return']:>9.2f}% {improved['avg_return']:>9.2f}% {avg_return:>9.2f}% {avg_return - baseline['avg_return']:>+9.2f}%")
    print(f"  {'Profit Factor':<20} {baseline['profit_factor']:>10.2f} {improved['profit_factor']:>10.2f} {profit_factor:>10.2f} {profit_factor - baseline['profit_factor']:>+10.2f}")
    print(f"  {'Avg Win':<20} {baseline['avg_win']:>9.2f}% {improved['avg_win']:>9.2f}% {avg_win:>9.2f}% {avg_win - baseline['avg_win']:>+9.2f}%")
    print(f"  {'Avg Loss':<20} {baseline['avg_loss']:>9.2f}% {improved['avg_loss']:>9.2f}% {avg_loss:>9.2f}% {avg_loss - baseline['avg_loss']:>+9.2f}%")
    print(f"  {'Total Trades':<20} {baseline['total_trades']:>10} {improved['total_trades']:>10} {total:>10}")

    print(f"\n  By Outcome:")
    for o, c in sorted(outcomes.items(), key=lambda x: -x[1]):
        print(f"    {o}: {c} ({c/total*100:.1f}%)")

    print(f"\n  By Signal:")
    for sig, d in sorted(by_signal.items(), key=lambda x: -x[1]['total']):
        wr = d['wins'] / d['total'] * 100 if d['total'] > 0 else 0
        avg_r = sum(d['returns']) / len(d['returns']) if d['returns'] else 0
        print(f"    {sig}: {d['total']} trades | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    print(f"\n  By Regime:")
    for reg, d in sorted(by_regime.items(), key=lambda x: -x[1]['total']):
        wr = d['wins'] / d['total'] * 100 if d['total'] > 0 else 0
        avg_r = sum(d['returns']) / len(d['returns']) if d['returns'] else 0
        print(f"    {reg}: {d['total']} trades | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    print(f"\n  By Conviction Level:")
    for bucket, d in sorted(by_conviction.items()):
        wr = d['wins'] / d['total'] * 100 if d['total'] > 0 else 0
        avg_r = sum(d['returns']) / len(d['returns']) if d['returns'] else 0
        print(f"    {bucket} factors: {d['total']} trades | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    # Save results
    results = {
        'date': datetime.now().isoformat(),
        'engine': 'PredictionOptimizer (mean-reversion + conviction + regime)',
        'total_trades': total,
        'skipped': skipped_count,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2),
        'avg_holding': round(avg_holding, 1),
        'improvement_vs_baseline': round(win_rate - baseline['win_rate'], 2),
    }
    output_path = PROJECT_ROOT / 'scripts' / 'optimized_results.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Results saved: {output_path}")

    # Verdict
    print(f"\n{'='*60}")
    if win_rate >= 60:
        print(f"🎯 هدف تحقق! Win Rate = {win_rate:.1f}% (>= 60%)")
    elif win_rate >= 50:
        print(f"📈 تحسن جيد! Win Rate = {win_rate:.1f}% (>= 50%)")
        print(f"   يحتاج +{60 - win_rate:.1f}% إضافية للوصول لـ 60%")
    else:
        print(f"⚠ يحتاج تحسين إضافي. Win Rate = {win_rate:.1f}%")
        print(f"   يحتاج +{60 - win_rate:.1f}% للوصول لـ 60%")


if __name__ == '__main__':
    run_optimized_backtest()
