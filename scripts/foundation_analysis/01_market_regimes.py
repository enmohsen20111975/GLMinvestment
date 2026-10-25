#!/usr/bin/env python3
"""
01_market_regimes.py — Market Regime Analysis (Foundation Part 1)
=================================================================
Analyzes EGX30/benchmark data to identify Bull/Bear/Sideways periods.
"""
from __future__ import annotations
import os, sys, json, sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'

def main():
    print(f"\n{'='*70}")
    print(f"  Foundation Part 1: Market Regime Analysis")
    print(f"{'='*70}\n")

    db_path = DB_DIR / 'price_history.db'
    if not db_path.exists():
        print("ERROR: price_history.db not found")
        return 1

    conn = sqlite3.connect(str(db_path), timeout=30.0)

    # Find benchmark ticker (EGX30ETF or similar)
    benchmarks = ['EGX30ETF', 'EGX30', 'EGX100', 'EGX70']
    benchmark_ticker = None
    for b in benchmarks:
        r = conn.execute("SELECT COUNT(*) FROM price_history WHERE ticker = ?", (b,)).fetchone()
        if r[0] > 100:
            benchmark_ticker = b
            break

    if not benchmark_ticker:
        # Use all tickers as proxy — compute market breadth
        print("  No benchmark ticker found. Using composite index.")
        # Get monthly average close for all tickers
        rows = conn.execute("""
            SELECT substr(date, 1, 7) as month, AVG(close_price) as avg_close, COUNT(DISTINCT ticker) as tickers
            FROM price_history
            WHERE date >= '2020-01-01' AND close_price > 0
            GROUP BY month ORDER BY month
        """).fetchall()
    else:
        print(f"  Using benchmark: {benchmark_ticker}")
        rows = conn.execute("""
            SELECT date, close_price FROM price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY date
        """, (benchmark_ticker,)).fetchall()

    print(f"  Data points: {len(rows)}")

    if len(rows) < 50:
        print("  ❌ Not enough data for regime analysis")
        conn.close()
        return 1

    # Compute monthly returns + identify regimes
    # For benchmark: use close prices
    # For composite: use avg_close per month
    
    if benchmark_ticker:
        # Daily data — convert to monthly
        monthly = {}
        for date, close in rows:
            month = date[:7]
            monthly[month] = close
        months = sorted(monthly.keys())
        closes = [monthly[m] for m in months]
    else:
        months = [r[0] for r in rows]
        closes = [r[1] for r in rows]

    # Calculate monthly returns
    returns = []
    for i in range(1, len(closes)):
        if closes[i-1] > 0:
            ret = (closes[i] / closes[i-1] - 1) * 100
            returns.append({'month': months[i], 'return': round(ret, 2), 'close': closes[i]})

    print(f"  Monthly returns calculated: {len(returns)}")

    # Identify regimes using 6-month moving average of returns
    regimes = []
    current_regime = {'type': 'UNKNOWN', 'start': returns[0]['month'], 'months': []}

    window = 6
    for i in range(len(returns)):
        # Compute 6-month average return
        if i >= window:
            avg_ret = sum(r['return'] for r in returns[i-window:i]) / window
        else:
            avg_ret = sum(r['return'] for r in returns[:i+1]) / (i + 1)

        # Classify
        if avg_ret > 2.0:
            regime_type = 'BULL'
        elif avg_ret < -2.0:
            regime_type = 'BEAR'
        else:
            regime_type = 'SIDEWAYS'

        if regime_type != current_regime['type']:
            if current_regime['months']:
                regimes.append(current_regime)
            current_regime = {'type': regime_type, 'start': returns[i]['month'], 'months': []}

        current_regime['months'].append(returns[i])

    if current_regime['months']:
        regimes.append(current_regime)

    # Calculate stats per regime
    regime_stats = []
    for r in regimes:
        if not r['months']:
            continue
        rets = [m['return'] for m in r['months']]
        total_ret = sum(rets)
        duration = len(rets)
        start_month = r['start']
        end_month = r['months'][-1]['month']
        
        # Max drawdown within regime
        peak = r['months'][0]['close']
        max_dd = 0
        for m in r['months']:
            if m['close'] > peak:
                peak = m['close']
            dd = (peak - m['close']) / peak * 100 if peak > 0 else 0
            if dd > max_dd:
                max_dd = dd

        regime_stats.append({
            'type': r['type'],
            'start': start_month,
            'end': end_month,
            'duration_months': duration,
            'total_return': round(total_ret, 1),
            'avg_monthly_return': round(total_ret / duration, 2),
            'max_drawdown': round(max_dd, 1),
        })

    # Print results
    print(f"\n  {'='*80}")
    print(f"  📊 MARKET REGIMES — EGX ({len(regime_stats)} periods)")
    print(f"  {'='*80}")
    print(f"  {'#':>3} {'Type':<10} {'Start':<8} {'End':<8} {'Months':>6} {'Total%':>8} {'Avg/mo':>7} {'MaxDD':>7}")
    print(f"  {'─'*70}")

    for i, r in enumerate(regime_stats, 1):
        emoji = '🟢' if r['type'] == 'BULL' else '🔴' if r['type'] == 'BEAR' else '🟡'
        print(f"  {i:>3} {emoji} {r['type']:<5} {r['start']:<8} {r['end']:<8} {r['duration_months']:>6} {r['total_return']:>+7.1f}% {r['avg_monthly_return']:>+6.2f}% {r['max_drawdown']:>6.1f}%")

    # Summary
    bull = [r for r in regime_stats if r['type'] == 'BULL']
    bear = [r for r in regime_stats if r['type'] == 'BEAR']
    side = [r for r in regime_stats if r['type'] == 'SIDEWAYS']

    print(f"\n  Summary:")
    print(f"    Bull periods:    {len(bull)} (avg {sum(r['duration_months'] for r in bull)/max(1,len(bull)):.0f} months)")
    print(f"    Bear periods:    {len(bear)} (avg {sum(r['duration_months'] for r in bear)/max(1,len(bear)):.0f} months)")
    print(f"    Sideways:        {len(side)} (avg {sum(r['duration_months'] for r in side)/max(1,len(side)):.0f} months)")

    if bull:
        print(f"    Avg Bull return: {sum(r['total_return'] for r in bull)/len(bull):+.1f}%")
    if bear:
        print(f"    Avg Bear loss:   {sum(r['total_return'] for r in bear)/len(bear):+.1f}%")

    # Key insight
    print(f"\n  🔑 Key Insight:")
    if bull and bear:
        bull_avg = sum(r['duration_months'] for r in bull) / len(bull)
        bear_avg = sum(r['duration_months'] for r in bear) / len(bear)
        print(f"    Bull markets avg {bull_avg:.0f} months, Bear avg {bear_avg:.0f} months")
        print(f"    Strategy should AVOID trading in Bear periods ({len(bear)}/{len(regime_stats)} periods)")

    conn.close()

    # Save JSON
    data_dir = PROJECT_ROOT / 'scripts' / 'foundation_analysis' / 'data'
    data_dir.mkdir(parents=True, exist_ok=True)
    output_path = data_dir / 'market_regimes.json'
    with open(output_path, 'w') as f:
        json.dump({
            'timestamp': datetime.now().isoformat(),
            'benchmark': benchmark_ticker or 'composite',
            'total_periods': len(regime_stats),
            'regimes': regime_stats,
            'summary': {
                'bull_count': len(bull),
                'bear_count': len(bear),
                'sideways_count': len(side),
            }
        }, f, indent=2, ensure_ascii=False)

    # Save markdown
    doc_dir = PROJECT_ROOT / 'Documentation' / 'FOUNDATION'
    doc_dir.mkdir(parents=True, exist_ok=True)
    doc_path = doc_dir / 'MARKET-REGIMES.md'
    with open(doc_path, 'w') as f:
        f.write(f"# Market Regime Analysis\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n")
        f.write(f"Benchmark: {benchmark_ticker or 'composite index'}\n\n")
        f.write(f"| # | Type | Start | End | Months | Total Return | Avg Monthly | Max Drawdown |\n")
        f.write(f"|---|------|-------|-----|--------|--------------|-------------|--------------|\n")
        for i, r in enumerate(regime_stats, 1):
            f.write(f"| {i} | {r['type']} | {r['start']} | {r['end']} | {r['duration_months']} | {r['total_return']:+.1f}% | {r['avg_monthly_return']:+.2f}% | -{r['max_drawdown']:.1f}% |\n")
        f.write(f"\n## Summary\n\n")
        f.write(f"- Bull periods: {len(bull)}\n")
        f.write(f"- Bear periods: {len(bear)}\n")
        f.write(f"- Sideways: {len(side)}\n")

    print(f"\n  💾 JSON: {output_path}")
    print(f"  📄 Report: {doc_path}")
    print(f"\n{'='*70}\n")

    return 0

if __name__ == '__main__':
    sys.exit(main())
