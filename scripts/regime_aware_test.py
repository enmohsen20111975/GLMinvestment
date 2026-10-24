#!/usr/bin/env python3
"""
regime_aware_test.py — Regime-Aware V38 Test
=============================================
Tests V38 performance in Bull/Bear/Sideways periods separately.
Then tests V38 + Bull-only filter vs baseline.
"""
from __future__ import annotations
import os, sys, json, math, sqlite3, time
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'
VPS = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS))
sys.path.insert(0, str(VPS / 'analyzers'))
sys.path.insert(0, str(VPS / 'jobs'))

# Regime periods from Part 1 (monthly classification)
# Format: (start_month, end_month, regime_type)
REGIMES = [
    ('2025-02', '2025-03', 'BEAR'),
    ('2025-04', '2025-04', 'SIDEWAYS'),
    ('2025-05', '2025-05', 'BULL'),
    ('2025-06', '2025-08', 'SIDEWAYS'),
    ('2025-09', '2025-10', 'BULL'),
    ('2025-11', '2026-01', 'SIDEWAYS'),
    ('2026-02', '2026-06', 'BEAR'),
]

# Full test period
TEST_START = '2025-07-01'
TEST_END = '2026-03-31'
MAX_TICKERS = 100
TARGET_PCT = 10.0
STOP_PCT = 7.0
HOLDING_DAYS = 30


def get_regime(date_str):
    """Get regime for a given date."""
    month = date_str[:7]
    for start, end, regime in REGIMES:
        if start <= month <= end:
            return regime
    return 'UNKNOWN'


def run_v38_signals(engine, indicators, start_date, end_date):
    """Run V38 and return all signals with their dates."""
    signals = []
    for ticker, candles in indicators.items():
        dates_t, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) < 50:
            continue
        for i in range(50, len(closes)):
            if dates_t[i] < start_date or dates_t[i] > end_date:
                continue
            try:
                result = engine.analyze_single_day(ticker, dates_t, opens, highs, lows, closes, volumes, i)
                signal = result.get('signal', 'WAIT')
                if signal in ('BUY', 'STRONG_BUY', 'INSTITUTIONAL_BUY'):
                    entry = result.get('entry_price', closes[i])
                    target = result.get('target_price') or entry * (1 + TARGET_PCT / 100)
                    stop = result.get('stop_loss') or entry * (1 - STOP_PCT / 100)
                    signals.append({
                        'date': dates_t[i],
                        'ticker': ticker,
                        'entry': entry,
                        'target': target,
                        'stop': stop,
                        'regime': get_regime(dates_t[i]),
                    })
            except:
                pass
    return signals


def calculate_metrics(signals, indicators, db_conn):
    """Calculate WR, PF, MaxDD for a set of signals."""
    wins = 0
    losses = 0
    expired = 0
    total_return = 0
    gross_profit = 0
    gross_loss = 0
    equity = 100000
    peak = equity
    max_dd = 0
    returns_list = []

    for sig in signals:
        ticker = sig['ticker']
        entry = sig['entry']
        target = sig['target']
        stop = sig['stop']
        date = sig['date']

        # Get future prices
        future = db_conn.execute("""
            SELECT high_price, low_price, close_price FROM price_history
            WHERE ticker = ? AND date > ?
            ORDER BY date ASC LIMIT ?
        """, (ticker, date, HOLDING_DAYS)).fetchall()

        exit_price = None
        exit_type = 'EXPIRED'

        for h, l, c in future:
            if l is not None and stop is not None and l <= stop:
                exit_price = stop
                exit_type = 'STOPPED'
                break
            if h is not None and target is not None and h >= target:
                exit_price = target
                exit_type = 'TARGET_HIT'
                break

        if exit_price is None and future:
            exit_price = future[-1][2] or entry

        if exit_price is None:
            continue

        return_pct = (exit_price / entry - 1) * 100
        total_return += return_pct
        returns_list.append(return_pct)

        if exit_type == 'TARGET_HIT':
            wins += 1
            gross_profit += return_pct
        elif exit_type == 'STOPPED':
            losses += 1
            gross_loss += abs(return_pct)
        else:
            expired += 1
            if return_pct > 0:
                gross_profit += return_pct
            else:
                gross_loss += abs(return_pct)

        # Equity curve for MaxDD
        equity += equity * (return_pct / 100)
        peak = max(peak, equity)
        dd = (peak - equity) / peak * 100 if peak > 0 else 0
        max_dd = max(max_dd, dd)

    total = wins + losses + expired
    if total == 0:
        return {'signals': 0, 'wr': 0, 'pf': 0, 'max_dd': 0, 'avg_ret': 0, 'wins': 0, 'losses': 0}

    wr = wins / total * 100
    pf = gross_profit / gross_loss if gross_loss > 0 else 0
    avg_ret = total_return / total

    # Sharpe (simplified)
    if len(returns_list) > 1:
        std = math.sqrt(sum((r - avg_ret) ** 2 for r in returns_list) / (len(returns_list) - 1))
        sharpe = avg_ret / std * math.sqrt(len(returns_list)) if std > 0 else 0
    else:
        sharpe = 0

    return {
        'signals': total,
        'wins': wins,
        'losses': losses,
        'expired': expired,
        'wr': round(wr, 1),
        'pf': round(pf, 2),
        'max_dd': round(max_dd, 1),
        'avg_ret': round(avg_ret, 2),
        'sharpe': round(sharpe, 2),
        'gross_profit': round(gross_profit, 1),
        'gross_loss': round(gross_loss, 1),
    }


def main():
    print(f"\n{'='*70}")
    print(f"  Regime-Aware V38 Test")
    print(f"  Period: {TEST_START} → {TEST_END}")
    print(f"{'='*70}\n")

    from engines.backtest_engine import V38BacktestEngine
    from jobs.predictor_modules.price_cache import pre_cache_price_history

    engine = V38BacktestEngine(buy_threshold=60, use_v393=True, market_code='EGX')
    engine._load_fundamentals()
    engine._load_benchmark()

    # Get tickers
    db_conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    tickers = [r[0] for r in db_conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= '2025-06-01' AND date <= ?
        AND ticker NOT LIKE '%.%'
        ORDER BY ticker LIMIT ?
    """, (TEST_END, MAX_TICKERS)).fetchall()]

    print(f"  Tickers: {len(tickers)}")
    pre_cache_price_history(tickers, engine)

    # Build indicators dict
    indicators = {}
    for ticker in tickers:
        dates_t, opens, highs, lows, closes, volumes = engine.get_price_data(ticker)
        if len(closes) >= 50:
            indicators[ticker] = True  # just a flag

    # Step 1: Generate ALL signals
    print(f"\n  Generating V38 signals...")
    t0 = time.time()
    all_signals = run_v38_signals(engine, indicators, TEST_START, TEST_END)
    print(f"  Generated {len(all_signals)} signals in {time.time()-t0:.1f}s")

    # Step 2: Split by regime
    bull_signals = [s for s in all_signals if s['regime'] == 'BULL']
    bear_signals = [s for s in all_signals if s['regime'] == 'BEAR']
    side_signals = [s for s in all_signals if s['regime'] == 'SIDEWAYS']
    unknown_signals = [s for s in all_signals if s['regime'] == 'UNKNOWN']

    print(f"\n  Signal distribution:")
    print(f"    BULL:      {len(bull_signals)}")
    print(f"    BEAR:      {len(bear_signals)}")
    print(f"    SIDEWAYS:  {len(side_signals)}")
    print(f"    UNKNOWN:   {len(unknown_signals)}")

    # Step 3: Calculate metrics per regime
    print(f"\n  Calculating metrics per regime...")

    all_metrics = calculate_metrics(all_signals, indicators, db_conn)
    bull_metrics = calculate_metrics(bull_signals, indicators, db_conn)
    bear_metrics = calculate_metrics(bear_signals, indicators, db_conn)
    side_metrics = calculate_metrics(side_signals, indicators, db_conn)

    # Step 4: Test filters
    # Bull only
    bull_only_signals = bull_signals + unknown_signals  # include unknown as neutral
    bull_only_metrics = calculate_metrics(bull_only_signals, indicators, db_conn)

    # Bull + Sideways (exclude Bear)
    no_bear_signals = [s for s in all_signals if s['regime'] != 'BEAR']
    no_bear_metrics = calculate_metrics(no_bear_signals, indicators, db_conn)

    db_conn.close()

    # ─── Print Results ───
    print(f"\n{'='*70}")
    print(f"  📊 TABLE 1: V38 Performance by Market Regime")
    print(f"{'='*70}\n")
    print(f"  {'Regime':<12} {'Signals':>7} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'AvgRet':>7} {'Sharpe':>7}")
    print(f"  {'─'*60}")
    for name, m in [('Bull', bull_metrics), ('Sideways', side_metrics), ('Bear', bear_metrics), ('All (baseline)', all_metrics)]:
        print(f"  {name:<12} {m['signals']:>7} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['avg_ret']:>+6.2f}% {m['sharpe']:>7.2f}")

    print(f"\n{'='*70}")
    print(f"  📊 TABLE 2: V38 + Regime Filter Comparison")
    print(f"{'='*70}\n")
    print(f"  {'Config':<25} {'Signals':>7} {'WR':>6} {'PF':>6} {'MaxDD':>7} {'AvgRet':>7}")
    print(f"  {'─'*65}")
    for name, m in [('V38 baseline (all)', all_metrics), ('V38 + Bull only', bull_only_metrics), ('V38 + No Bear', no_bear_metrics)]:
        print(f"  {name:<25} {m['signals']:>7} {m['wr']:>5.1f}% {m['pf']:>6.2f} -{m['max_dd']:>5.1f}% {m['avg_ret']:>+6.2f}%")

    # Decision
    print(f"\n{'='*70}")
    best_pf = max(all_metrics['pf'], bull_only_metrics['pf'], no_bear_metrics['pf'])
    best_wr = max(all_metrics['wr'], bull_only_metrics['wr'], no_bear_metrics['wr'])

    if best_pf >= 1.3 and best_wr >= 55:
        print(f"  🟢 DEPLOY READY — Best PF={best_pf:.2f}, WR={best_wr:.1f}%")
        print(f"  → Regime filter works! Can deploy with caution.")
    elif best_pf >= 1.1:
        print(f"  🟡 NEEDS TUNING — Best PF={best_pf:.2f}, WR={best_wr:.1f}%")
        print(f"  → Close to deployable. Needs threshold adjustments.")
    else:
        print(f"  🔴 V38 FAILED — Best PF={best_pf:.2f}, WR={best_wr:.1f}%")
        print(f"  → V38 is not profitable even with regime filtering.")
        print(f"  → Needs fundamental redesign.")
    print(f"{'='*70}\n")

    # Save
    output = {
        'timestamp': datetime.now().isoformat(),
        'table1_regime_performance': {
            'bull': bull_metrics,
            'sideways': side_metrics,
            'bear': bear_metrics,
            'all_baseline': all_metrics,
        },
        'table2_filter_comparison': {
            'baseline': all_metrics,
            'bull_only': bull_only_metrics,
            'no_bear': no_bear_metrics,
        },
        'best_pf': best_pf,
        'best_wr': best_wr,
    }

    output_path = PROJECT_ROOT / 'Documentation' / 'REGIME-AWARE-TEST.md'
    with open(output_path, 'w') as f:
        f.write(f"# Regime-Aware V38 Test\n\n")
        f.write(f"Generated: {datetime.now().isoformat()}\n\n")
        f.write(f"## Table 1: V38 Performance by Market Regime\n\n")
        f.write(f"| Regime | Signals | WR | PF | Max DD | Avg Return | Sharpe |\n")
        f.write(f"|--------|---------|-----|-----|--------|------------|--------|\n")
        for name, m in [('Bull', bull_metrics), ('Sideways', side_metrics), ('Bear', bear_metrics), ('All (baseline)', all_metrics)]:
            f.write(f"| {name} | {m['signals']} | {m['wr']}% | {m['pf']} | -{m['max_dd']}% | {m['avg_ret']}% | {m['sharpe']} |\n")
        f.write(f"\n## Table 2: V38 + Regime Filter Comparison\n\n")
        f.write(f"| Config | Signals | WR | PF | Max DD | Avg Return |\n")
        f.write(f"|--------|---------|-----|-----|--------|------------|\n")
        for name, m in [('V38 baseline (all)', all_metrics), ('V38 + Bull only', bull_only_metrics), ('V38 + No Bear', no_bear_metrics)]:
            f.write(f"| {name} | {m['signals']} | {m['wr']}% | {m['pf']} | -{m['max_dd']}% | {m['avg_ret']}% |\n")

    json_path = PROJECT_ROOT / 'scripts' / 'foundation_analysis' / 'data' / 'regime_aware_test.json'
    json_path.parent.mkdir(parents=True, exist_ok=True)
    with open(json_path, 'w') as f:
        json.dump(output, f, indent=2, ensure_ascii=False)

    print(f"  💾 Report: {output_path}")
    print(f"  💾 JSON: {json_path}")


if __name__ == '__main__':
    main()
