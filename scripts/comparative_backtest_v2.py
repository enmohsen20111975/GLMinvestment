#!/usr/bin/env python3
"""
Comparative Backtest V2 — باك-تست مقارن مبسّط
=================================================
بدلاً من تشغيل V40.2 كامل (الذي يرفض معظم الإشارات في backtest mode)،
هذا الـ script بـ يـ focus على:
  1. تحميل بيانات حقيقية من price_history.db
  2. توليد إشارات مبسطة (surge/accumulation)
  3. تطبيق طبقات الفلاتر (strict entry, notebook, etc.)
  4. محاكاة الصفقة (entry/stop/target/exit)
  5. مقارنة النتائج بـ/بدون الطبقات

النسخ: B0, B1, B2, B4 (نفس الإعداد)

Author: Z.ai Code
Date: 2026-09-01
"""

import sys
import os
import json
import math
import sqlite3
import time
from pathlib import Path
from datetime import datetime, timedelta
from typing import List, Dict, Any, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))

START_DATE = '2026-02-01'
END_DATE = '2026-08-14'
MAX_TICKERS = 50
HOLDING_DAYS = 20  # max holding for simulation


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


def _sma(values, period):
    if len(values) < period:
        return sum(values) / len(values) if values else 0
    return sum(values[-period:]) / period


# ═══════════════════════════════════════════════════════════════════════
# Data loading
# ═══════════════════════════════════════════════════════════════════════

def load_tickers(max_count=50):
    """Load EGX tickers from price_history.db."""
    db = PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db'
    conn = sqlite3.connect(str(db), timeout=10)
    rows = conn.execute('''
        SELECT ticker FROM price_history
        WHERE ticker NOT LIKE '.%' AND ticker NOT LIKE '%.%'
        GROUP BY ticker
        HAVING COUNT(*) >= 100
        ORDER BY ticker
        LIMIT ?
    ''', (max_count,)).fetchall()
    conn.close()
    return [r[0] for r in rows]


def load_price_data(ticker):
    """Load OHLCV for a ticker."""
    db = PROJECT_ROOT / 'db' / 'vps_real' / 'price_history.db'
    conn = sqlite3.connect(str(db), timeout=10)
    rows = conn.execute('''
        SELECT date, open_price, high_price, low_price, close_price, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0 AND volume > 0
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
# Signal generation (simplified)
# ═══════════════════════════════════════════════════════════════════════

def generate_signal(closes, highs, lows, volumes, day_idx):
    """Generate a BUY signal if conditions met."""
    if day_idx < 30 or day_idx >= len(closes) - HOLDING_DAYS:
        return None

    sl_closes = closes[:day_idx + 1]
    sl_highs = highs[:day_idx + 1]
    sl_lows = lows[:day_idx + 1]
    sl_vols = volumes[:day_idx + 1]

    entry = closes[day_idx]
    atr = _safe_atr(sl_highs, sl_lows, sl_closes, 14)
    if atr <= 0:
        return None

    rsi = _rsi(sl_closes, 14)
    ma50 = _sma(sl_closes, min(50, len(sl_closes)))
    vol_ma20 = _sma(sl_vols[-20:], 20) if len(sl_vols) >= 20 else 1
    vol_ratio = sl_vols[-1] / vol_ma20 if vol_ma20 > 0 else 0

    # Simple signal: RSI < 50 + above MA50 + volume surge
    if rsi < 50 and entry > ma50 and vol_ratio > 1.3:
        stop = entry - (atr * 1.5)
        target = entry + (atr * 3.0)
        risk = entry - stop
        if risk <= 0:
            return None
        rr = (target - entry) / risk
        if rr < 1.5:
            return None

        return {
            'entry': entry,
            'stop': stop,
            'target': target,
            'atr': atr,
            'rsi': rsi,
            'vol_ratio': vol_ratio,
            'closes': sl_closes,
            'highs': sl_highs,
            'lows': sl_lows,
            'volumes': sl_vols,
        }

    return None


# ═══════════════════════════════════════════════════════════════════════
# Trade simulation
# ═══════════════════════════════════════════════════════════════════════

def simulate_trade(signal, future_highs, future_lows, future_closes, max_days=HOLDING_DAYS):
    """Simulate trade outcome."""
    entry = signal['entry']
    stop = signal['stop']
    target = signal['target']

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
# Run one backtest version
# ═══════════════════════════════════════════════════════════════════════

def run_version(label, flags, tickers):
    """Run one backtest version with specific flags."""
    print(f"\n{'='*70}")
    print(f"🧪 {label}")
    print(f"   Flags: {flags}")
    print(f"{'='*70}", flush=True)

    trades = []
    rejects = {'late_entry': 0, 'not_accumulation': 0, 'notebook_reject': 0,
               'disclosure_veto': 0, 'stop_widened': 0}

    # Set env flags for this run
    for k, v in flags.items():
        os.environ[k] = v

    for ticker in tickers:
        data = load_price_data(ticker)
        if not data:
            continue

        # Find scan dates in range
        for i in range(30, len(data['closes']) - HOLDING_DAYS):
            date = data['dates'][i]
            if date < START_DATE or date > END_DATE:
                continue

            # Generate signal
            signal = generate_signal(data['closes'], data['highs'], data['lows'], data['volumes'], i)
            if not signal:
                continue

            # Apply Strict Entry filter
            if flags.get('V40_2_STRICT_ENTRY') == '1':
                from analyzers.strict_entry_filters import evaluate_strict_entry
                entry_result = evaluate_strict_entry(
                    signal['closes'], signal['highs'], signal['lows'], signal['volumes'], rsi=signal['rsi']
                )
                if entry_result['decision'] == 'REJECT':
                    if entry_result.get('is_late'):
                        rejects['late_entry'] += 1
                    else:
                        rejects['not_accumulation'] += 1
                    continue

            # Apply Notebook context
            notebook_proofs = []
            stop_distance_pct = ((signal['entry'] - signal['stop']) / signal['entry'] * 100)

            if flags.get('V40_2_NOTEBOOK_CONTEXT') == '1':
                from analyzers.stock_notebook import apply_notebook_context
                nb_ctx = apply_notebook_context(
                    ticker, current_score=70, stop_distance_pct=stop_distance_pct,
                    is_chasing=entry_result.get('is_late', False) if flags.get('V40_2_STRICT_ENTRY') == '1' else False
                )
                if nb_ctx['should_reject']:
                    rejects['notebook_reject'] += 1
                    notebook_proofs.append(f'🚨 NOTEBOOK REJECT: {nb_ctx["reject_reason"]}')
                    continue

                if nb_ctx['stop_adjustment_pct'] > 0:
                    # Widen stop
                    signal['stop'] = signal['entry'] * (1 - (stop_distance_pct + nb_ctx['stop_adjustment_pct']) / 100)
                    rejects['stop_widened'] += 1
                    notebook_proofs.append(f'📖 stop widen +{nb_ctx["stop_adjustment_pct"]}%')

                notebook_proofs.extend(nb_ctx.get('proofs', []))

            # Simulate trade
            future_highs = data['highs'][i + 1: i + 1 + HOLDING_DAYS]
            future_lows = data['lows'][i + 1: i + 1 + HOLDING_DAYS]
            future_closes = data['closes'][i + 1: i + 1 + HOLDING_DAYS]

            result = simulate_trade(signal, future_highs, future_lows, future_closes)

            # Apply Short Holding + Distribution Exit (B4)
            if flags.get('V40_2_SHORT_HOLDING') == '1':
                from analyzers.short_holding_exit import evaluate_force_exit
                # Build price_history for holding check
                sh_history = [{'close': c} for c in data['closes'][i+1:i+1+result['days']+1]]
                force = evaluate_force_exit(
                    entry_time=date, current_time=data['dates'][min(i + result['days'], len(data['dates'])-1)],
                    entry_price=signal['entry'], current_price=future_closes[result['days']-1] if future_closes else signal['entry'],
                    price_history=sh_history,
                    opens=data['opens'][i+1:i+1+result['days']+1],
                    highs=future_highs[:result['days']],
                    lows=future_lows[:result['days']],
                    closes=future_closes[:result['days']],
                    volumes=data['volumes'][i+1:i+1+result['days']+1],
                )
                if force['should_exit']:
                    # Override exit reason
                    exit_price = future_closes[force['details'].get('time_elapsed', result['days'])-1] if future_closes else signal['entry']
                    result['exit_reason'] = force['exit_code']
                    result['return_pct'] = ((exit_price - signal['entry']) / signal['entry'] * 100)
                    result['days'] = int(force['details'].get('time_elapsed', result['days']))

            trades.append({
                'ticker': ticker,
                'date': date,
                'entry': signal['entry'],
                'stop': signal['stop'],
                'target': signal['target'],
                'return_pct': result['return_pct'],
                'outcome': result['outcome'],
                'exit_reason': result['exit_reason'],
                'days': result['days'],
                'notebook_proofs': notebook_proofs,
                'rsi': signal['rsi'],
                'vol_ratio': signal['vol_ratio'],
            })

    # Compute metrics
    if not trades:
        return {'label': label, 'trades': 0, 'rejects': rejects}

    wins = [t for t in trades if t['return_pct'] > 0]
    losses = [t for t in trades if t['return_pct'] <= 0]
    profits = [t['return_pct'] for t in wins]
    losses_amt = [abs(t['return_pct']) for t in losses]
    gross_profit = sum(profits)
    gross_loss = sum(losses_amt)
    pf = (gross_profit / gross_loss) if gross_loss > 0 else (999.0 if gross_profit > 0 else 0)
    total_return = sum(t['return_pct'] for t in trades)
    avg_holding = sum(t['days'] for t in trades) / len(trades) if trades else 0

    exit_reasons = {}
    for t in trades:
        er = t['exit_reason']
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
        'avg_holding_days': round(avg_holding, 1),
        'exit_reasons': exit_reasons,
        'rejects': rejects,
        'trades_detail': trades[:30],
    }


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

def main():
    print(f"🚀 Comparative Backtest V2 — {START_DATE} → {END_DATE}")

    tickers = load_tickers(MAX_TICKERS)
    print(f"   Tickers: {len(tickers)}")

    RUNS = [
        ('B0_baseline', {
            'V40_2_STRICT_ENTRY': '0', 'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_SHORT_HOLDING': '0', 'V40_2_DISTRIBUTION_EXIT': '0',
        }),
        ('B1_strict_entry', {
            'V40_2_STRICT_ENTRY': '1', 'V40_2_NOTEBOOK_CONTEXT': '0',
            'V40_2_SHORT_HOLDING': '0', 'V40_2_DISTRIBUTION_EXIT': '0',
        }),
        ('B2_notebook', {
            'V40_2_STRICT_ENTRY': '1', 'V40_2_NOTEBOOK_CONTEXT': '1',
            'V40_2_SHORT_HOLDING': '0', 'V40_2_DISTRIBUTION_EXIT': '0',
        }),
        ('B4_full_stack', {
            'V40_2_STRICT_ENTRY': '1', 'V40_2_NOTEBOOK_CONTEXT': '1',
            'V40_2_SHORT_HOLDING': '1', 'V40_2_DISTRIBUTION_EXIT': '1',
        }),
    ]

    results = []
    for label, flags in RUNS:
        result = run_version(label, flags, tickers)
        results.append(result)

    # Print comparison
    print(f"\n{'='*95}")
    print("📊 COMPARATIVE BACKTEST V2 — مقارنة الطبقات (بيانات حقيقية)")
    print(f"{'='*95}")
    print(f"{'Run':<20} {'Trades':>7} {'WR%':>7} {'PF':>6} {'Return%':>9} {'AvgW':>7} {'AvgL':>7} {'Hold':>5}")
    print("-" * 95)
    for r in results:
        print(f"{r['label']:<20} {r.get('trades',0):>7} "
              f"{r.get('win_rate',0):>6.1f}% "
              f"{r.get('profit_factor',0):>6.2f} "
              f"{r.get('total_return',0):>+8.1f}% "
              f"{r.get('avg_win',0):>+6.2f}% "
              f"{r.get('avg_loss',0):>+6.2f}% "
              f"{r.get('avg_holding_days',0):>4.1f}d")

    # Rejects
    print(f"\n{'='*95}")
    print("🚫 Rejects (أسباب الرفض)")
    print(f"{'='*95}")
    print(f"{'Run':<20} {'late_entry':>10} {'not_accum':>10} {'notebook':>10} {'stop_widen':>10}")
    print("-" * 95)
    for r in results:
        rej = r.get('rejects', {})
        print(f"{r['label']:<20} {rej.get('late_entry',0):>10} {rej.get('not_accumulation',0):>10} "
              f"{rej.get('notebook_reject',0):>10} {rej.get('stop_widened',0):>10}")

    # Exit reasons
    print(f"\n{'='*95}")
    print("🚪 Exit Reasons")
    print(f"{'='*95}")
    all_reasons = set()
    for r in results:
        if r.get('exit_reasons'):
            all_reasons.update(r['exit_reasons'].keys())
    if all_reasons:
        print(f"{'Run':<20}", end='')
        for reason in sorted(all_reasons):
            print(f" {reason[:12]:>12}", end='')
        print()
        for r in results:
            print(f"{r['label']:<20}", end='')
            for reason in sorted(all_reasons):
                print(f" {r.get('exit_reasons',{}).get(reason, 0):>12}", end='')
            print()

    # Qualitative examples
    print(f"\n{'='*95}")
    print("📝 Qualitative Examples (قبل/بعد — نصوص التحليل)")
    print(f"{'='*95}")
    b0 = results[0]
    b2 = results[2] if len(results) > 2 else None
    b4 = results[3] if len(results) > 3 else None

    if b0.get('trades_detail') and b2 and b2.get('trades_detail'):
        # Find trades in B2 that have notebook_proofs
        nb_trades = [t for t in b2.get('trades_detail', []) if t.get('notebook_proofs')]
        print(f"\nB0 trades: {b0['trades']} | B2 trades: {b2['trades']}")
        print(f"B2 trades with notebook proofs: {len(nb_trades)}")
        for t in nb_trades[:5]:
            print(f"\n  📖 {t['ticker']} on {t['date']}:")
            print(f"     entry={t['entry']:.2f} stop={t['stop']:.2f} return={t['return_pct']:+.1f}%")
            print(f"     proofs: {t['notebook_proofs']}")

    # Save
    RESULTS_DIR = PROJECT_ROOT / 'data' / 'comparative_results'
    RESULTS_DIR.mkdir(parents=True, exist_ok=True)
    final = {
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
        'period': f'{START_DATE} → {END_DATE}',
        'tickers': len(tickers),
        'results': results,
    }
    (RESULTS_DIR / 'comparative_v2_results.json').write_text(json.dumps(final, indent=2, default=str))
    print(f"\n💾 Results saved to: {RESULTS_DIR}")


if __name__ == '__main__':
    main()
