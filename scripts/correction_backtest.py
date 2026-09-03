#!/usr/bin/env python3
"""
Correction Opportunity Backtest — اختبار قاسي لمحرك التصحيح
================================================================
يختبر: هل detect_correction_opportunity بـ يحدد أفضل وقت دخول؟

المنهجية:
  1. لكل سهم، امسح كل يوم في الفترة (Feb-Aug 2026)
  2. في كل يوم، شغّل detect_correction_opportunity
  3. لو phase = RECOVERY_STARTING أو LATE_BASE (readiness >= 60):
     → سجّل "إشارة دخول" في هذا اليوم
  4. محاكاة الصفقة: دخول عند close + stop عند recent low - ATR + target عند entry + 2×ATR
  5. تتبع النتيجة بعد 20 يوم
  6. قارن:
     - استراتيجية التصحيح (entry عند readiness >= 60)
     - استراتيجية عشوائية (entry في أي يوم)
     - استراتيجية المطاردة (entry بعد صعود قوي)

الفترة: 2026-02-01 → 2026-08-14 (6 شهور)
الكون: كل أسهم EGX ببيانات كافية (100+ يوم)

Usage:
  python3 scripts/correction_backtest.py
  python3 scripts/correction_backtest.py --max-tickers 200
"""

import sys
import os
import json
import math
import sqlite3
import time
from pathlib import Path
from datetime import datetime
from typing import List, Dict, Any, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = 200
HOLDING_DAYS = 20


# ═══════════════════════════════════════════════════════════════════════
# Helpers
# ═══════════════════════════════════════════════════════════════════════

def _safe_atr(highs, lows, closes, period=14):
    n = min(len(highs), len(lows), len(closes))
    if n < 2:
        return 0
    trs = []
    for i in range(max(1, n - period), n):
        tr = max(highs[i] - lows[i], abs(highs[i] - closes[i-1]), abs(lows[i] - closes[i-1]))
        trs.append(tr)
    return sum(trs) / len(trs) if trs else 0


def _rsi(closes, period=14):
    if len(closes) < period + 1:
        return 50
    gains, losses = [], []
    for i in range(len(closes) - period, len(closes)):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / len(gains) if gains else 0
    avg_loss = sum(losses) / len(losses) if losses else 0
    if avg_loss == 0:
        return 100
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))


# ═══════════════════════════════════════════════════════════════════════
# Data loading
# ═══════════════════════════════════════════════════════════════════════

def load_tickers(max_count=200):
    """تحميل أسهم EGX فقط (alpha tickers — مش أرقام سعودية)."""
    db = PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db'
    if not db.exists():
        db = PROJECT_ROOT / 'db' / 'price_history.db'
    conn = sqlite3.connect(str(db), timeout=10)
    rows = conn.execute('''
        SELECT ticker FROM price_history
        WHERE ticker NOT LIKE '.%' AND ticker NOT LIKE '%.%'
          AND length(ticker) <= 5
          AND substr(ticker, 1, 1) BETWEEN 'A' AND 'Z'
        GROUP BY ticker HAVING COUNT(*) >= 100
        ORDER BY ticker LIMIT ?
    ''', (max_count,)).fetchall()
    conn.close()
    # Filter: only pure alpha (A-Z) tickers
    return [r[0] for r in rows if r[0].isalpha() and len(r[0]) <= 5]


def load_price_data(ticker):
    db = PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db'
    if not db.exists():
        db = PROJECT_ROOT / 'db' / 'price_history.db'
    conn = sqlite3.connect(str(db), timeout=10)
    rows = conn.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history WHERE ticker = ? AND close_price > 0 AND volume > 0
        ORDER BY date ASC
    ''', (ticker,)).fetchall()
    conn.close()
    if len(rows) < 60:
        return None
    return {
        'dates': [r[0] for r in rows],
        'opens': [float(r[1] or 0) for r in rows],
        'highs': [float(r[2] or 0) for r in rows],
        'lows': [float(r[3] or 0) for r in rows],
        'closes': [float(r[4] or 0) for r in rows],
        'volumes': [float(r[5] or 0) for r in rows],
    }


# ═══════════════════════════════════════════════════════════════════════
# Trade simulation
# ═══════════════════════════════════════════════════════════════════════

def simulate_trade(entry, stop, target, future_highs, future_lows, future_closes, max_days=HOLDING_DAYS):
    for i in range(min(len(future_highs), max_days)):
        if future_lows[i] <= stop:
            return {'outcome': 'stop', 'return_pct': ((stop - entry) / entry * 100),
                    'days': i + 1, 'exit_reason': 'stop_loss'}
        if future_highs[i] >= target:
            return {'outcome': 'target', 'return_pct': ((target - entry) / entry * 100),
                    'days': i + 1, 'exit_reason': 'target_hit'}
    last_close = future_closes[min(max_days - 1, len(future_closes) - 1)]
    return {'outcome': 'timeout', 'return_pct': ((last_close - entry) / entry * 100),
            'days': max_days, 'exit_reason': 'expired'}


# ═══════════════════════════════════════════════════════════════════════
# Strategy 1: Correction Opportunity (entry when readiness >= threshold)
# ═══════════════════════════════════════════════════════════════════════

def run_correction_strategy(tickers, readiness_threshold=60):
    """استراتيجية التصحيح: دخول عند readiness >= threshold"""
    from utils.stock_state import detect_correction_opportunity
    from analyzers.stock_notebook import get_machine_summary

    trades = []
    signals_by_phase = {'NO_CORRECTION': 0, 'EARLY_DROP': 0, 'DEEP_CORRECTION': 0,
                         'LATE_BASE': 0, 'RECOVERY_STARTING': 0}

    for ticker in tickers:
        data = load_price_data(ticker)
        if not data:
            continue

        ms = get_machine_summary(ticker)
        typical = ms.get('typical_correction_pct', 0)

        for i in range(40, len(data['closes']) - HOLDING_DAYS):
            date = data['dates'][i]
            if date < START_DATE or date > END_DATE:
                continue

            sl_closes = data['closes'][:i+1]
            sl_highs = data['highs'][:i+1]
            sl_lows = data['lows'][:i+1]
            sl_vols = data['volumes'][:i+1]

            r = detect_correction_opportunity(sl_closes, sl_highs, sl_lows, sl_vols,
                                                typical_correction_pct=typical)
            signals_by_phase[r['phase']] = signals_by_phase.get(r['phase'], 0) + 1

            if r['entry_readiness'] < readiness_threshold:
                continue

            # Entry signal!
            entry = data['closes'][i]
            atr = _safe_atr(sl_highs, sl_lows, sl_closes, 14)
            if atr <= 0:
                continue

            # Stop: recent low - 0.5×ATR
            recent_low = min(sl_lows[-10:]) if len(sl_lows) >= 10 else min(sl_lows)
            stop = recent_low - (atr * 0.5)
            target = entry + (atr * 3.0)

            if stop >= entry or target <= entry:
                continue

            # Simulate
            future_highs = data['highs'][i+1: i+1+HOLDING_DAYS]
            future_lows = data['lows'][i+1: i+1+HOLDING_DAYS]
            future_closes = data['closes'][i+1: i+1+HOLDING_DAYS]

            result = simulate_trade(entry, stop, target, future_highs, future_lows, future_closes)

            trades.append({
                'ticker': ticker,
                'date': date,
                'entry': entry,
                'stop': stop,
                'target': target,
                'phase': r['phase'],
                'phase_ar': r['phase_ar'],
                'readiness': r['entry_readiness'],
                'depth_pct': r['depth_pct'],
                'vol_state': r['vol_state'],
                'rsi': r['rsi'],
                'return_pct': result['return_pct'],
                'outcome': result['outcome'],
                'exit_reason': result['exit_reason'],
                'days': result['days'],
                'proofs': r['proofs'],
            })

    return trades, signals_by_phase


# ═══════════════════════════════════════════════════════════════════════
# Strategy 2: Random entry (baseline)
# ═══════════════════════════════════════════════════════════════════════

def run_random_strategy(tickers, max_signals=50):
    """استراتيجية عشوائية: دخول في أي يوم"""
    import random
    random.seed(42)

    trades = []
    all_possible = []

    for ticker in tickers:
        data = load_price_data(ticker)
        if not data:
            continue
        for i in range(40, len(data['closes']) - HOLDING_DAYS):
            date = data['dates'][i]
            if date < START_DATE or date > END_DATE:
                continue
            all_possible.append((ticker, i, data))

    # Sample
    sampled = random.sample(all_possible, min(max_signals, len(all_possible)))

    for ticker, i, data in sampled:
        entry = data['closes'][i]
        atr = _safe_atr(data['highs'][:i+1], data['lows'][:i+1], data['closes'][:i+1], 14)
        if atr <= 0:
            continue
        stop = entry - (atr * 1.5)
        target = entry + (atr * 3.0)
        if stop >= entry:
            continue

        future_highs = data['highs'][i+1: i+1+HOLDING_DAYS]
        future_lows = data['lows'][i+1: i+1+HOLDING_DAYS]
        future_closes = data['closes'][i+1: i+1+HOLDING_DAYS]
        result = simulate_trade(entry, stop, target, future_highs, future_lows, future_closes)

        trades.append({
            'ticker': ticker,
            'date': data['dates'][i],
            'entry': entry,
            'return_pct': result['return_pct'],
            'outcome': result['outcome'],
            'exit_reason': result['exit_reason'],
            'days': result['days'],
        })

    return trades


# ═══════════════════════════════════════════════════════════════════════
# Strategy 3: Chase entry (buy after strong rally)
# ═══════════════════════════════════════════════════════════════════════

def run_chase_strategy(tickers):
    """استراتيجية المطاردة: دخول بعد صعود +15% في 5 أيام"""
    trades = []

    for ticker in tickers:
        data = load_price_data(ticker)
        if not data:
            continue
        for i in range(10, len(data['closes']) - HOLDING_DAYS):
            date = data['dates'][i]
            if date < START_DATE or date > END_DATE:
                continue

            sl_closes = data['closes'][:i+1]
            if len(sl_closes) < 6:
                continue
            gain_5d = ((sl_closes[-1] - sl_closes[-6]) / sl_closes[-6] * 100) if sl_closes[-6] > 0 else 0
            if gain_5d < 15:  # Only chase after +15% in 5 days
                continue

            entry = data['closes'][i]
            atr = _safe_atr(data['highs'][:i+1], data['lows'][:i+1], sl_closes, 14)
            if atr <= 0:
                continue
            stop = entry - (atr * 1.5)
            target = entry + (atr * 3.0)
            if stop >= entry:
                continue

            future_highs = data['highs'][i+1: i+1+HOLDING_DAYS]
            future_lows = data['lows'][i+1: i+1+HOLDING_DAYS]
            future_closes = data['closes'][i+1: i+1+HOLDING_DAYS]
            result = simulate_trade(entry, stop, target, future_highs, future_lows, future_closes)

            trades.append({
                'ticker': ticker,
                'date': date,
                'entry': entry,
                'gain_5d': gain_5d,
                'return_pct': result['return_pct'],
                'outcome': result['outcome'],
                'exit_reason': result['exit_reason'],
                'days': result['days'],
            })

    return trades


# ═══════════════════════════════════════════════════════════════════════
# Metrics
# ═══════════════════════════════════════════════════════════════════════

def compute_metrics(trades, label):
    if not trades:
        return {'label': label, 'trades': 0, 'win_rate': 0, 'profit_factor': 0,
                'total_return': 0, 'avg_return': 0, 'avg_win': 0, 'avg_loss': 0,
                'avg_holding': 0, 'exit_reasons': {}}

    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] <= 0]
    profits = [t['return_pct'] for t in wins]
    losses_amt = [abs(t['return_pct']) for t in losses]
    gross_profit = sum(profits)
    gross_loss = sum(losses_amt)
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0)
    total_return = sum(t['return_pct'] for t in trades)
    avg_holding = sum(t.get('days', 0) for t in trades) / len(trades) if trades else 0

    exit_reasons = {}
    for t in trades:
        er = t.get('exit_reason', 'unknown')
        exit_reasons[er] = exit_reasons.get(er, 0) + 1

    return {
        'label': label,
        'trades': len(trades),
        'wins': len(wins),
        'losses': len(losses),
        'win_rate': round(len(wins) / len(trades) * 100, 1) if trades else 0,
        'profit_factor': round(pf, 2) if pf < 999 else 999.0,
        'total_return': round(total_return, 2),
        'avg_return': round(total_return / len(trades), 2) if trades else 0,
        'avg_win': round(sum(profits) / len(profits), 2) if profits else 0,
        'avg_loss': round(-sum(losses_amt) / len(losses_amt), 2) if losses_amt else 0,
        'avg_holding': round(avg_holding, 1),
        'exit_reasons': exit_reasons,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

def main():
    import argparse
    parser = argparse.ArgumentParser(description='Correction Opportunity Backtest')
    parser.add_argument('--max-tickers', type=int, default=MAX_TICKERS)
    args = parser.parse_args()

    print(f"🚀 Correction Opportunity Backtest — {START_DATE} → {END_DATE}")
    tickers = load_tickers(args.max_tickers)
    print(f"   Tickers: {len(tickers)}")
    print(f"   Strategies: Correction (readiness≥60) vs Random vs Chase")
    print()

    # Strategy 1: Correction Opportunity
    print("━━━ Strategy 1: Correction Opportunity (readiness ≥ 60) ━━━")
    correction_trades, signals_by_phase = run_correction_strategy(tickers, readiness_threshold=60)
    correction_metrics = compute_metrics(correction_trades, 'Correction (≥60%)')
    print(f"   Trades: {correction_metrics['trades']}")
    print(f"   Signals by phase: {signals_by_phase}")
    print()

    # Strategy 1b: Correction Opportunity (readiness >= 70)
    print("━━━ Strategy 1b: Correction Opportunity (readiness ≥ 70) ━━━")
    correction_trades_70, _ = run_correction_strategy(tickers, readiness_threshold=70)
    correction_metrics_70 = compute_metrics(correction_trades_70, 'Correction (≥70%)')
    print(f"   Trades: {correction_metrics_70['trades']}")
    print()

    # Strategy 2: Random
    print("━━━ Strategy 2: Random Entry ━━━")
    random_trades = run_random_strategy(tickers, max_signals=min(50, len(correction_trades) or 50))
    random_metrics = compute_metrics(random_trades, 'Random')
    print(f"   Trades: {random_metrics['trades']}")
    print()

    # Strategy 3: Chase
    print("━━━ Strategy 3: Chase Entry (+15% in 5d) ━━━")
    chase_trades = run_chase_strategy(tickers)
    chase_metrics = compute_metrics(chase_trades, 'Chase (+15%)')
    print(f"   Trades: {chase_metrics['trades']}")
    print()

    # Comparison
    print(f"\n{'='*95}")
    print("📊 COMPARISON — Correction vs Random vs Chase")
    print(f"{'='*95}")
    print(f"{'Strategy':<25} {'Trades':>7} {'WR%':>7} {'PF':>6} {'Return%':>9} {'AvgR%':>7} {'AvgW':>7} {'AvgL':>7} {'Hold':>5}")
    print("-" * 95)
    for m in [correction_metrics, correction_metrics_70, random_metrics, chase_metrics]:
        print(f"{m['label']:<25} {m['trades']:>7} {m['win_rate']:>6.1f}% "
              f"{m['profit_factor']:>6.2f} {m['total_return']:>+8.1f}% "
              f"{m['avg_return']:>+6.2f}% {m['avg_win']:>+6.2f}% {m['avg_loss']:>+6.2f}% "
              f"{m['avg_holding']:>4.1f}d")
    print("-" * 95)

    # Exit reasons
    print(f"\n{'='*95}")
    print("🚪 Exit Reasons")
    print(f"{'='*95}")
    all_reasons = set()
    for m in [correction_metrics, correction_metrics_70, random_metrics, chase_metrics]:
        all_reasons.update(m.get('exit_reasons', {}).keys())
    if all_reasons:
        print(f"{'Strategy':<25}", end='')
        for reason in sorted(all_reasons):
            print(f" {reason[:12]:>12}", end='')
        print()
        for m in [correction_metrics, correction_metrics_70, random_metrics, chase_metrics]:
            print(f"{m['label']:<25}", end='')
            for reason in sorted(all_reasons):
                print(f" {m.get('exit_reasons',{}).get(reason, 0):>12}", end='')
            print()

    # Qualitative examples
    print(f"\n{'='*95}")
    print("📝 Correction Trades (أمثلة نوعية)")
    print(f"{'='*95}")
    for t in correction_trades[:10]:
        print(f"\n  {t['ticker']} on {t['date']}:")
        print(f"    phase: {t['phase']} ({t['phase_ar']}) | readiness: {t['readiness']}%")
        print(f"    entry: {t['entry']:.2f} | stop: {t['stop']:.2f} | target: {t['target']:.2f}")
        print(f"    depth: {t['depth_pct']:.1f}% | vol: {t['vol_state']} | RSI: {t['rsi']:.0f}")
        print(f"    return: {t['return_pct']:+.1f}% ({t['exit_reason']}, {t['days']}d)")
        if t.get('proofs'):
            print(f"    proofs: {t['proofs'][:2]}")

    # Winner determination
    print(f"\n{'='*95}")
    print("🏆 VERDICT")
    print(f"{'='*95}")
    valid = [m for m in [correction_metrics, correction_metrics_70, random_metrics, chase_metrics] if m['trades'] > 0]
    if valid:
        best_wr = max(valid, key=lambda x: x['win_rate'])
        best_pf = max(valid, key=lambda x: x['profit_factor'])
        best_ret = max(valid, key=lambda x: x['total_return'])
        print(f"  Best Win Rate: {best_wr['label']} ({best_wr['win_rate']:.1f}%)")
        print(f"  Best Profit Factor: {best_pf['label']} ({best_pf['profit_factor']:.2f})")
        print(f"  Best Return: {best_ret['label']} ({best_ret['total_return']:+.1f}%)")

    # Save
    RESULTS_DIR = PROJECT_ROOT / 'data' / 'correction_backtest_results'
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    final = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'period': f'{START_DATE} → {END_DATE}',
        'tickers': len(tickers),
        'signals_by_phase': signals_by_phase,
        'metrics': {
            'correction_60': correction_metrics,
            'correction_70': correction_metrics_70,
            'random': random_metrics,
            'chase': chase_metrics,
        },
        'correction_trades': correction_trades[:30],
    }
    (RESULTS_DIR / 'results.json').write_text(json.dumps(final, indent=2, default=str))
    print(f"\n💾 Results saved to: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
