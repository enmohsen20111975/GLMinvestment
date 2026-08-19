#!/usr/bin/env python3
"""
Simulated Backtest — محاكاة تاريخية لقياس دقة المحرك الحالي
================================================================
بما أنه لا توجد توقعات مغلقة في الـ DB (DailyCloser لم يكن يعمل)،
هذا السكريبت يعمل محاكاة:
1. يأخذ أسعار تاريخية لكل سهم
2. لكل تاريخ محاكاة، يحسب RSI + MA + S/R
3. يولّد إشارة BUY/SELL/HOLD مع target/stop
4. يفحص الأسعار المستقبلية لمعرفة هل target أم stop ضُرب أولاً
5. يحسب win rate + avg return + profit factor

النتيجة = baseline نقيس عليه التحسينات.
"""

import sqlite3
import os
import json
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parent.parent
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')

# Backtest parameters
SAMPLE_SIZE = 50           # عدد الأسهم للمحاكاة
SIM_DAYS = 60              # عدد أيام المحاكاة (من آخر 60 يوم تاريخي)
MAX_HOLDING = 20           # حد أقصى لاحتجاز الصفقة
MIN_HISTORY = 100          # حد أدنى للبيانات التاريخية قبل المحاكاة


def calc_rsi(prices, period=14):
    """حساب RSI."""
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


def calc_sma(prices, period):
    """Simple Moving Average."""
    if len(prices) < period:
        return sum(prices) / len(prices) if prices else 0
    return sum(prices[-period:]) / period


def calc_support_resistance(prices, lookback=20):
    """حساب الدعم والمقاومة من آخر lookback يوم."""
    if len(prices) < lookback:
        lookback = len(prices)
    recent = prices[-lookback:]
    return min(recent), max(recent)


def generate_signal(prices, volumes):
    """
    توليد إشارة بسيطة (محاكاة منطق MasterAnalyzer).
    يعيد: (signal, score, entry, target, stop)
    """
    if len(prices) < 50:
        return ('HOLD', 50, prices[-1] if prices else 0, 0, 0)

    current = prices[-1]
    rsi = calc_rsi(prices)
    sma20 = calc_sma(prices, 20)
    sma50 = calc_sma(prices, 50)
    support, resistance = calc_support_resistance(prices)

    score = 50

    # Technical signals
    if current > sma20 > sma50:
        score += 10  # Bullish trend
    elif current < sma20 < sma50:
        score -= 10  # Bearish trend

    if rsi < 30:
        score += 8  # Oversold → buy signal
    elif rsi > 70:
        score -= 8  # Overbought → sell signal

    # Proximity to support/resistance
    if support > 0:
        dist_to_support = (current - support) / current * 100
        if dist_to_support < 3:
            score += 5  # Near support

    if resistance > 0:
        dist_to_resist = (resistance - current) / current * 100
        if dist_to_resist < 3:
            score -= 5  # Near resistance

    # Clamp
    score = max(0, min(100, score))

    # Signal
    if score >= 55:
        signal = 'BUY'
    elif score >= 45:
        signal = 'HOLD'
    elif score >= 25:
        signal = 'SELL'
    else:
        signal = 'STRONG_SELL'

    # Target/stop (based on S/R + volatility)
    if signal in ('BUY',):
        target = resistance if resistance > current else current * 1.08
        stop = support if support < current else current * 0.95
        # Ensure R/R >= 1.5
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

    return (signal, score, current, target, stop)


def simulate_prediction(prices_after, entry, target, stop, signal, max_holding=MAX_HOLDING):
    """
    محاكاة ما يحدث بعد التوقع: هل target أم stop ضُرب أولاً؟
    يعود: (outcome, actual_return, holding_days)
    """
    if signal == 'HOLD' or len(prices_after) == 0:
        return ('HOLD', 0, 0)

    for i, price in enumerate(prices_after[:max_holding]):
        if signal in ('BUY',):
            if price >= target:
                return ('TARGET_HIT', (target - entry) / entry * 100, i + 1)
            if price <= stop:
                return ('STOPPED', (stop - entry) / entry * 100, i + 1)
        else:  # SELL / STRONG_SELL
            if price <= target:
                return ('TARGET_HIT', (entry - target) / entry * 100, i + 1)
            if price >= stop:
                return ('STOPPED', (entry - stop) / entry * 100, i + 1)

    # Expired — use last price
    last = prices_after[min(max_holding - 1, len(prices_after) - 1)]
    if signal in ('BUY',):
        ret = (last - entry) / entry * 100
    else:
        ret = (entry - last) / entry * 100
    return ('EXPIRED', ret, max_holding)


def run_backtest():
    """تشغيل المحاكاة الكاملة."""
    print(f"\n{'#'*70}")
    print(f"# 📊 Simulated Backtest — Baseline")
    print(f"# Sample: {SAMPLE_SIZE} stocks | Sim days: {SIM_DAYS} | Max hold: {MAX_HOLDING}")
    print(f"{'#'*70}")

    conn = sqlite3.connect(PRICE_HISTORY_DB)

    # Get stocks with enough history
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
        # Get all price data for this stock
        rows = conn.execute("""
            SELECT date, close_price
            FROM price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY date ASC
        """, (stock_ticker,)).fetchall()

        if len(rows) < MIN_HISTORY + SIM_DAYS:
            continue

        prices = [r[1] for r in rows]
        dates = [r[0] for r in rows]

        # Simulate predictions for the last SIM_DAYS days
        for sim_day in range(SIM_DAYS):
            entry_idx = len(prices) - SIM_DAYS - MAX_HOLDING + sim_day
            if entry_idx < MIN_HISTORY:
                continue
            if entry_idx + MAX_HOLDING >= len(prices):
                continue

            hist_prices = prices[:entry_idx + 1]
            future_prices = prices[entry_idx + 1:]

            signal, score, entry, target, stop = generate_signal(hist_prices, [])
            if signal == 'HOLD':
                continue

            outcome, ret, holding = simulate_prediction(
                future_prices, entry, target, stop, signal
            )

            all_trades.append({
                'ticker': stock_ticker,
                'date': dates[entry_idx],
                'signal': signal,
                'score': score,
                'entry': entry,
                'target': target,
                'stop': stop,
                'outcome': outcome,
                'return': ret,
                'holding': holding,
            })

    conn.close()

    if not all_trades:
        print("\n⚠ No trades generated — check data")
        return

    # Analyze results
    total = len(all_trades)
    wins = sum(1 for t in all_trades if t['return'] > 0)
    losses = total - wins
    win_rate = wins / total * 100 if total > 0 else 0

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

    # By score range
    by_score = {}
    for t in all_trades:
        bucket = int(t['score'] // 10) * 10
        if bucket not in by_score:
            by_score[bucket] = {'total': 0, 'wins': 0, 'returns': []}
        by_score[bucket]['total'] += 1
        if t['return'] > 0:
            by_score[bucket]['wins'] += 1
        by_score[bucket]['returns'].append(t['return'])

    # Print results
    print(f"\n{'='*60}")
    print(f"📊 النتائج (Baseline)")
    print(f"{'='*60}")
    print(f"\n  Total trades: {total}")
    print(f"  Wins: {wins} | Losses: {losses}")
    print(f"  Win Rate: {win_rate:.1f}%")
    print(f"  Avg Return: {avg_return:.2f}%")
    print(f"  Avg Win: +{avg_win:.2f}%")
    print(f"  Avg Loss: {avg_loss:.2f}%")
    print(f"  Profit Factor: {profit_factor:.2f}")
    print(f"  Avg Holding: {avg_holding:.1f} days")

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
        'sample_size': SAMPLE_SIZE,
        'sim_days': SIM_DAYS,
        'max_holding': MAX_HOLDING,
        'total_trades': total,
        'win_rate': round(win_rate, 2),
        'avg_return': round(avg_return, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2),
        'avg_holding': round(avg_holding, 1),
        'by_outcome': outcomes,
        'by_signal': {sig: {
            'total': d['total'],
            'win_rate': round(d['wins'] / d['total'] * 100, 1) if d['total'] > 0 else 0,
            'avg_return': round(sum(d['returns']) / len(d['returns']), 2) if d['returns'] else 0,
        } for sig, d in by_signal.items()},
    }

    output_path = PROJECT_ROOT / 'scripts' / 'baseline_results.json'
    with open(output_path, 'w') as f:
        json.dump(results, f, indent=2, ensure_ascii=False)
    print(f"\n💾 Results saved: {output_path}")

    print(f"\n💡 هذا هو الـ baseline. بعد تحسين المحركات (Track 2) + الأوزان التكييفية (Track 3),")
    print(f"   نشغل نفس المحاكاة ونقارن الأرقام.")


if __name__ == '__main__':
    run_backtest()
