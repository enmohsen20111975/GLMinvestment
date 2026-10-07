#!/usr/bin/env python3
"""
POC A/B Test — Point of Control Hard Gate vs Soft Signal
=========================================================
Owner directive (2026-10-07): "بالتجارب والأرقام هي اللي هتتحكم"

الـ backtest ده بيـ answer السؤال:
  هل نحوّل الـ POC من soft signal (boost ±0.3) لـ hard gate (kill)?

الـ script بيـ run 4 variants على نفس البيانات:
  - Baseline:        POC soft signal (زي ما هو في entry_gate.py دلوقتي)
  - Variant A:       POC hard gate — kill لو السعر فوق POC بـ ≥ 5% (premium)
  - Variant B:       POC hard gate — kill لو السعر فوق POC بـ ≥ 3% (premium)
  - Variant C:       POC hard gate — kill لو السعر At POC أو فوقه (≥ 0%)

لكل variant بيـ حساب:
  - عدد الإشارات (signals)
  - Win Rate (WR)
  - Profit Factor (PF)
  - Avg Return
  - Max Drawdown

الأرقام هي اللي تقرر أي variant يـ adopt.
"""
import sys
import os
from pathlib import Path
from collections import defaultdict, Counter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

# Reuse canonical backtest functions (Rule 54)
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
from backtest_4months_all_stocks import (
    load_all_egx_tickers,
    load_price_history,
    generate_signal,
    evaluate_prediction,
)


def compute_poc(closes, volumes, lookback=20):
    """
    Point of Control = السعر اللي عنده أعلى volume في آخر `lookback` يوم.
    بـ يرجع (poc_price, distance_pct):
      - distance_pct > 0 → السعر تحت POC (discount)
      - distance_pct < 0 → السعر فوق POC (premium)
    """
    if not closes or not volumes or len(closes) < 5 or len(volumes) < 5:
        return None, None
    lb = min(len(closes), len(volumes), lookback)
    if lb < 5:
        return None, None
    paired = list(zip(closes[-lb:], volumes[-lb:]))
    poc_price, _poc_vol = max(paired, key=lambda x: x[1])
    price = closes[-1]
    if poc_price <= 0:
        return None, None
    distance_pct = ((poc_price - price) / poc_price) * 100.0
    return poc_price, distance_pct


def passes_poc_gate(closes, volumes, variant):
    """
    POC gate check لكل variant.
    بـ يرجع True لو السهم عدّى الـ gate، False لو اتـ rejected.
    """
    if variant == 'baseline':
        return True  # soft signal — no hard gate
    poc_price, dist = compute_poc(closes, volumes)
    if poc_price is None or dist is None:
        return True  # بيانات غير كافية → safe-by-design
    if variant == 'gate_5pct':
        # kill لو السعر فوق POC بـ ≥ 5% (dist <= -5)
        return dist > -5.0
    if variant == 'gate_3pct':
        # kill لو السعر فوق POC بـ ≥ 3%
        return dist > -3.0
    if variant == 'gate_0pct':
        # kill لو السعر At POC أو فوقه (dist <= 0)
        return dist > 0.0
    return True


def run_variant(variant_name, start_date='2026-05-01', end_date='2026-09-03',
                max_holding_days=30):
    """Run backtest for one POC variant."""
    tickers = load_all_egx_tickers()
    print(f'\n[{variant_name}] Loaded {len(tickers)} tickers', flush=True)

    all_results = []
    signals_count = 0
    rejected_by_gate = 0
    signal_dist = Counter()
    ticker_recent_returns = defaultdict(list)
    CIRCUIT_BREAKER_LOSSES = 2
    CIRCUIT_BREAKER_COOLDOWN_DAYS = 5
    ticker_cooldown_until = {}

    processed = 0
    for ticker in tickers:
        try:
            history = load_price_history(ticker, '2026-01-01')
            if len(history) < 60:
                continue
            dates = [row['date'] for row in history]
            closes = [float(row['close_price']) for row in history]
            highs = [float(row['high_price']) for row in history]
            lows = [float(row['low_price']) for row in history]
            volumes = [float(row['volume'] or 0) for row in history]

            for i in range(50, len(history)):
                d = dates[i]
                if d < start_date or d > end_date:
                    continue

                # Circuit breaker check
                if ticker in ticker_cooldown_until and ticker_cooldown_until[ticker] >= d:
                    continue

                sub_closes = closes[:i+1]
                sub_highs = highs[:i+1]
                sub_lows = lows[:i+1]
                sub_vols = volumes[:i+1]

                # ★ POC GATE CHECK ★
                if not passes_poc_gate(sub_closes, sub_vols, variant_name):
                    rejected_by_gate += 1
                    continue

                pred = generate_signal(sub_closes, sub_highs, sub_lows, sub_vols)
                if not pred or pred['signal'] == 'HOLD':
                    continue

                signals_count += 1
                signal_dist[pred['signal']] += 1
                pred['ticker'] = ticker
                pred['date'] = d

                future_closes = closes[i+1: i+1+max_holding_days]
                result = evaluate_prediction(pred, future_closes)
                if result is None:
                    continue

                all_results.append(result)
                ticker_recent_returns[ticker].append(result['return'])
                if len(ticker_recent_returns[ticker]) > 5:
                    ticker_recent_returns[ticker] = ticker_recent_returns[ticker][-5:]
                recent = ticker_recent_returns[ticker][-CIRCUIT_BREAKER_LOSSES:]
                if len(recent) >= CIRCUIT_BREAKER_LOSSES and all(r < 0 for r in recent):
                    ticker_cooldown_until[ticker] = d

            processed += 1
            if processed % 50 == 0:
                print(f'  [{variant_name}] processed {processed}/{len(tickers)} tickers '
                      f'— signals: {signals_count}', flush=True)
        except Exception as e:
            continue

    # Compute stats
    if not all_results:
        return {
            'variant': variant_name,
            'signals': 0,
            'rejected_by_gate': rejected_by_gate,
            'wr': 0.0,
            'pf': 0.0,
            'avg_return': 0.0,
            'max_dd': 0.0,
            'signal_dist': dict(signal_dist),
        }

    wins = [r for r in all_results if r['is_win'] == 1]
    losses = [r for r in all_results if r['is_win'] == 0]
    returns = [r['return'] for r in all_results]

    wr = len(wins) / len(all_results) * 100
    gross_profit = sum(r['return'] for r in wins if r['return'] > 0)
    gross_loss = abs(sum(r['return'] for r in losses if r['return'] < 0))
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')
    avg_return = sum(returns) / len(returns)

    # Max drawdown (peak-to-trough on cumulative returns)
    cumulative = 0
    peak = 0
    max_dd = 0
    for r in returns:
        cumulative += r
        if cumulative > peak:
            peak = cumulative
        dd = peak - cumulative
        if dd > max_dd:
            max_dd = dd

    return {
        'variant': variant_name,
        'signals': signals_count,
        'rejected_by_gate': rejected_by_gate,
        'trades': len(all_results),
        'wins': len(wins),
        'losses': len(losses),
        'wr': wr,
        'pf': pf,
        'avg_return': avg_return,
        'max_dd': max_dd,
        'signal_dist': dict(signal_dist),
    }


def main():
    print('=' * 78)
    print('🧪 POC A/B Test — Point of Control Hard Gate vs Soft Signal')
    print('Owner directive: "بالتجارب والأرقام هي اللي هتتحكم"')
    print('=' * 78)

    variants = [
        ('baseline',   'POC soft signal (زي ما هو — no hard gate)'),
        ('gate_5pct',  'POC hard gate — kill لو سعر فوق POC بـ ≥ 5%'),
        ('gate_3pct',  'POC hard gate — kill لو سعر فوق POC بـ ≥ 3%'),
        ('gate_0pct',  'POC hard gate — kill لو سعر At POC أو فوقه'),
    ]

    results = []
    for variant_name, desc in variants:
        print(f'\n{"─" * 78}')
        print(f'▶ VARIANT: {variant_name}')
        print(f'  {desc}')
        print(f'{"─" * 78}')
        r = run_variant(variant_name)
        results.append(r)
        print(f'\n  ✦ {variant_name}: signals={r["signals"]} '
              f'trades={r.get("trades", 0)} '
              f'WR={r["wr"]:.1f}% '
              f'PF={r["pf"]:.2f} '
              f'avgRet={r["avg_return"]:.2f}% '
              f'maxDD={r["max_dd"]:.2f}% '
              f'rejected={r["rejected_by_gate"]}')

    # Final comparison table
    print('\n')
    print('=' * 78)
    print('📊 FINAL COMPARISON TABLE')
    print('=' * 78)
    print(f'{"Variant":<14} {"Signals":>8} {"Trades":>8} {"WR%":>7} {"PF":>7} '
          f'{"AvgRet%":>9} {"MaxDD%":>8} {"Rejected":>9}')
    print('-' * 78)
    for r in results:
        print(f'{r["variant"]:<14} {r["signals"]:>8} {r.get("trades", 0):>8} '
              f'{r["wr"]:>6.1f}% {r["pf"]:>7.2f} '
              f'{r["avg_return"]:>+8.2f}% {r["max_dd"]:>+7.2f}% '
              f'{r["rejected_by_gate"]:>9}')

    print('\n' + '=' * 78)
    print('📋 DECISION RULE')
    print('=' * 78)
    baseline = results[0]
    best_variant = baseline
    best_score = baseline['pf'] * (baseline['wr'] / 100.0)  # rough composite
    for r in results[1:]:
        # Composite score: PF × WR (higher = better)
        score = r['pf'] * (r['wr'] / 100.0) if r['pf'] != float('inf') else 999
        if score > best_score and r['trades'] >= 20:
            best_variant = r
            best_score = score

    if best_variant['variant'] == 'baseline':
        print('🏆 النتيجة: الـ baseline (soft signal) هو الأفضل.')
        print('   يبقى الـ POC زي ما هو — soft signal (boost ±0.3).')
        print('   مفيش داعي لـ hard gate.')
    else:
        print(f'🏆 النتيجة: {best_variant["variant"]} هو الأفضل بالأرقام.')
        print(f'   WR: {baseline["wr"]:.1f}% → {best_variant["wr"]:.1f}%')
        print(f'   PF: {baseline["pf"]:.2f} → {best_variant["pf"]:.2f}')
        print(f'   AvgRet: {baseline["avg_return"]:+.2f}% → {best_variant["avg_return"]:+.2f}%')
        print(f'   Rejected by gate: {best_variant["rejected_by_gate"]} signals')
        print(f'\n   → يُوصى بـ adopt الـ {best_variant["variant"]} كـ hard gate.')

    print('\n' + '=' * 78)


if __name__ == '__main__':
    main()
