#!/usr/bin/env python3
"""
Improved Backtest — قياس الدقة بعد التحسينات (Track 2 + 3)
================================================================
نفس محاكاة baseline_backtest لكن باستخدام المحركات الجديدة:
- EnhancedIndicators (MACD, Bollinger, Stochastic, ADX, Williams)
- MultiTimeframeEngine (daily/weekly/monthly confluence)
- VolumeProfileAnalyzer (VWAP, OBV, A/D)
- AdaptiveWeightsEngine (regime + sector aware)

المقارنة مع baseline:
- Baseline: 41.3% win rate, PF 1.12
- Target: 50%+ win rate, PF 1.5+
"""

import sqlite3
import os
import json
import sys
from pathlib import Path
from datetime import datetime

# Add vps-service to path
PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

from analyzers.enhanced_indicators import EnhancedIndicators
from analyzers.multi_timeframe_engine import MultiTimeframeEngine
from analyzers.volume_profile import VolumeProfileAnalyzer
from analyzers.adaptive_weights import AdaptiveWeightsEngine, detect_regime

SAMPLE_SIZE = 50
SIM_DAYS = 60
MAX_HOLDING = 20
MIN_HISTORY = 100


def load_stock_prices(conn, ticker, min_count=150):
    """تحميل أسعار سهم معين."""
    rows = conn.execute("""
        SELECT date, close_price, high_price, low_price, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date ASC
    """, (ticker,)).fetchall()
    if len(rows) < min_count:
        return None
    return rows


def generate_enhanced_signal(prices, highs, lows, volumes):
    """
    توليد إشارة باستخدام المحركات الجديدة + الأوزان التكييفية.
    """
    if len(prices) < 50:
        return ('HOLD', 50, prices[-1] if prices else 0, 0, 0)

    current = prices[-1]

    # 1. Enhanced indicators
    enhanced = EnhancedIndicators().analyze(prices, highs, lows)
    enhanced_score = enhanced.composite_score

    # 2. Multi-timeframe
    mtf = MultiTimeframeEngine().analyze(prices)
    mtf_score = mtf.confluence_score

    # 3. Volume profile
    vol = VolumeProfileAnalyzer().analyze(prices, volumes or [])
    vol_score = vol.composite_score if hasattr(vol, 'composite_score') else 50

    # 4. Simple technical (RSI + MA) — keep for comparison
    rsi = _calc_rsi(prices)
    sma20 = sum(prices[-20:]) / 20
    sma50 = sum(prices[-50:]) / 50

    tech_score = 50
    if current > sma20 > sma50:
        tech_score += 10
    elif current < sma20 < sma50:
        tech_score -= 10
    if rsi < 30:
        tech_score += 8
    elif rsi > 70:
        tech_score -= 8
    tech_score = max(0, min(100, tech_score))

    # 5. Detect regime + compute adaptive weights
    regime = detect_regime(prices)
    aw_engine = AdaptiveWeightsEngine()
    volatility = (max(prices[-20:]) - min(prices[-20:])) / current * 100 if len(prices) >= 20 else 0
    aw = aw_engine.compute_weights(regime=regime, sector='DEFAULT', volatility_pct=volatility)
    w = aw.weights

    # 6. Composite score using adaptive weights
    # Use 4 main components: tech, enhanced, mtf, volume
    master_score = (
        tech_score * w.get('technical', 0.15) +
        enhanced_score * w.get('enhanced_indicators', 0.15) +
        mtf_score * w.get('multi_timeframe', 0.10) +
        vol_score * w.get('volume_profile', 0.05)
    ) / (w.get('technical', 0.15) + w.get('enhanced_indicators', 0.15) +
         w.get('multi_timeframe', 0.10) + w.get('volume_profile', 0.05))

    # 7. Signal
    if master_score >= 55:
        signal = 'BUY'
    elif master_score >= 45:
        signal = 'HOLD'
    elif master_score >= 25:
        signal = 'SELL'
    else:
        signal = 'STRONG_SELL'

    # 8. Target/stop
    support = min(prices[-20:]) if len(prices) >= 20 else current * 0.95
    resistance = max(prices[-20:]) if len(prices) >= 20 else current * 1.05

    if signal == 'BUY':
        target = resistance if resistance > current else current * 1.08
        stop = support if support < current else current * 0.95
        risk = current - stop
        reward = target - current
        if risk > 0 and reward / risk < 1.5:
            target = current + risk * 1.5
    elif signal in ('SELL', 'STRONG_SELL'):
        target = support if support < current else current * 0.92
        stop = resistance if resistance > current else current * 1.05
        risk = stop - current
        reward = current - target
        if risk > 0 and reward / risk < 1.5:
            target = current - risk * 1.5
    else:
        target = current
        stop = current

    return (signal, master_score, current, target, stop)


def _calc_rsi(prices, period=14):
    if len(prices) < period + 1:
        return 50.0
    gains, losses = [], []
    for i in range(1, len(prices)):
        diff = prices[i] - prices[i-1]
        gains.append(max(0, diff))
        losses.append(max(0, -diff))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


def simulate_prediction(prices_after, entry, target, stop, signal, max_holding=MAX_HOLDING):
    if signal == 'HOLD' or len(prices_after) == 0:
        return ('HOLD', 0, 0)
    for i, price in enumerate(prices_after[:max_holding]):
        if signal in ('BUY',):
            if price >= target:
                return ('TARGET_HIT', (target - entry) / entry * 100, i + 1)
            if price <= stop:
                return ('STOPPED', (stop - entry) / entry * 100, i + 1)
        else:
            if price <= target:
                return ('TARGET_HIT', (entry - target) / entry * 100, i + 1)
            if price >= stop:
                return ('STOPPED', (entry - stop) / entry * 100, i + 1)
    last = prices_after[min(max_holding - 1, len(prices_after) - 1)]
    if signal in ('BUY',):
        ret = (last - entry) / entry * 100
    else:
        ret = (entry - last) / entry * 100
    return ('EXPIRED', ret, max_holding)


def run_backtest():
    print(f"\n{'#'*70}")
    print(f"# 📊 Improved Backtest — بعد Track 2 + 3")
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

    all_trades = []

    for stock_ticker, _ in stocks:
        rows = load_stock_prices(conn, stock_ticker, MIN_HISTORY + SIM_DAYS + MAX_HOLDING)
        if not rows:
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

            signal, score, entry, target, stop = generate_enhanced_signal(
                hist_prices, hist_highs, hist_lows, hist_volumes
            )
            if signal == 'HOLD':
                continue

            outcome, ret, holding = simulate_prediction(
                future_prices, entry, target, stop, signal
            )

            all_trades.append({
                'ticker': stock_ticker,
                'signal': signal,
                'score': score,
                'entry': entry,
                'outcome': outcome,
                'return': ret,
                'holding': holding,
            })

    conn.close()

    if not all_trades:
        print("\n⚠ No trades generated")
        return

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

    outcomes = {}
    for t in all_trades:
        outcomes[t['outcome']] = outcomes.get(t['outcome'], 0) + 1

    by_signal = {}
    for t in all_trades:
        sig = t['signal']
        if sig not in by_signal:
            by_signal[sig] = {'total': 0, 'wins': 0, 'returns': []}
        by_signal[sig]['total'] += 1
        if t['return'] > 0:
            by_signal[sig]['wins'] += 1
        by_signal[sig]['returns'].append(t['return'])

    by_score = {}
    for t in all_trades:
        bucket = int(t['score'] // 10) * 10
        if bucket not in by_score:
            by_score[bucket] = {'total': 0, 'wins': 0, 'returns': []}
        by_score[bucket]['total'] += 1
        if t['return'] > 0:
            by_score[bucket]['wins'] += 1
        by_score[bucket]['returns'].append(t['return'])

    print(f"\n{'='*60}")
    print(f"📊 النتائج (بعد Track 2 + 3)")
    print(f"{'='*60}")
    print(f"\n  Total trades: {total}")
    print(f"  Wins: {wins} | Losses: {losses}")
    print(f"  Win Rate: {win_rate:.1f}%")
    print(f"  Avg Return: {avg_return:.2f}%")
    print(f"  Avg Win: +{avg_win:.2f}%")
    print(f"  Avg Loss: {avg_loss:.2f}%")
    print(f"  Profit Factor: {profit_factor:.2f}")
    print(f"  Avg Holding: {avg_holding:.1f} days")

    # Compare with baseline
    print(f"\n{'='*60}")
    print(f"📈 المقارنة مع Baseline")
    print(f"{'='*60}")
    baseline = json.load(open(PROJECT_ROOT / 'scripts' / 'baseline_results.json'))
    print(f"\n  {'Metric':<20} {'Baseline':>10} {'Improved':>10} {'Change':>10}")
    print(f"  {'-'*50}")
    print(f"  {'Win Rate':<20} {baseline['win_rate']:>9.1f}% {win_rate:>9.1f}% {win_rate - baseline['win_rate']:>+9.1f}%")
    print(f"  {'Avg Return':<20} {baseline['avg_return']:>9.2f}% {avg_return:>9.2f}% {avg_return - baseline['avg_return']:>+9.2f}%")
    print(f"  {'Profit Factor':<20} {baseline['profit_factor']:>10.2f} {profit_factor:>10.2f} {profit_factor - baseline['profit_factor']:>+10.2f}")
    print(f"  {'Avg Win':<20} {baseline['avg_win']:>9.2f}% {avg_win:>9.2f}% {avg_win - baseline['avg_win']:>+9.2f}%")
    print(f"  {'Avg Loss':<20} {baseline['avg_loss']:>9.2f}% {avg_loss:>9.2f}% {avg_loss - baseline['avg_loss']:>+9.2f}%")

    print(f"\n  By Outcome:")
    for o, c in sorted(outcomes.items(), key=lambda x: -x[1]):
        print(f"    {o}: {c} ({c/total*100:.1f}%)")

    print(f"\n  By Signal:")
    for sig, d in sorted(by_signal.items(), key=lambda x: -x[1]['total']):
        wr = d['wins'] / d['total'] * 100 if d['total'] > 0 else 0
        avg_r = sum(d['returns']) / len(d['returns']) if d['returns'] else 0
        print(f"    {sig}: {d['total']} trades | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    print(f"\n  By Score Range:")
    for bucket, d in sorted(by_score.items()):
        wr = d['wins'] / d['total'] * 100 if d['total'] > 0 else 0
        avg_r = sum(d['returns']) / len(d['returns']) if d['returns'] else 0
        print(f"    {bucket}-{bucket+9}: {d['total']} trades | WR: {wr:.1f}% | Avg: {avg_r:.2f}%")

    # Save results
    results = {
        'date': datetime.now().isoformat(),
        'total_trades': total,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2),
        'avg_holding': round(avg_holding, 1),
        'improvement': {
            'win_rate_delta': round(win_rate - baseline['win_rate'], 2),
            'profit_factor_delta': round(profit_factor - baseline['profit_factor'], 2),
        },
    }
    output_path = PROJECT_ROOT / 'scripts' / 'improved_results.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Results saved: {output_path}")


if __name__ == '__main__':
    run_backtest()
