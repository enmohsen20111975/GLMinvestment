#!/usr/bin/env python3
"""
event_driven_and_trend_egx30.py — استراتيجيتين جديدتين على EGX

الاستراتيجية 1: Event-driven (شراء بعد تصحيحات حادة)
  - شراء لو السهم نزل > 15% في 5 أيام (تصحيح حاد)
  - بس في أسهم قيادية (سيولة 50M+ EGP)
  - SL = 5% (أوسع من MR لأن التصحيحات أعمق)
  - TGT = 15% (هدف أكبر)
  - Hold = 10 أيام

الاستراتيجية 2: Trend على EGX30 (50-day high breakout)
  - شراء لو COMI (proxy لـ EGX30) اخترق أعلى 50 يوم
  - SL = 4%
  - TGT = 12%
  - Hold = 15 يوم

الاختبار: 2024 / 2025 / 2026 منفصل + Null Model + p-value
"""
import sys
import os
import sqlite3
import json
import numpy as np
from datetime import datetime
from pathlib import Path
from collections import defaultdict

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'


# ═══════════════════════════════════════════════════════════════════════
# Config — Event-driven
# ═══════════════════════════════════════════════════════════════════════

# Event-driven: شراء بعد تصحيح حاد
DROP_THRESHOLD = -15.0     # نزل > 15% في 5 أيام
DROP_WINDOW = 5            # 5 أيام
EVENT_MIN_TURNOVER = 50_000_000  # 50M EGP (أسهم قيادية)
EVENT_SL_PCT = 5.0         # SL 5%
EVENT_TGT_PCT = 15.0       # TGT 15%
EVENT_HOLDING = 10         # 10 أيام

# Trend على EGX30
TREND_LOOKBACK = 50        # 50-day high
TREND_SL_PCT = 4.0         # SL 4%
TREND_TGT_PCT = 12.0       # TGT 12%
TREND_HOLDING = 15         # 15 يوم

COST_RT = 1.0              # تكاليف round-trip 1%


# ═══════════════════════════════════════════════════════════════════════
# Load data
# ═══════════════════════════════════════════════════════════════════════

def load_ticker_data(start_date='2024-01-01', end_date='2026-10-18'):
    """تحميل بيانات كل الأسهم"""
    ph_db = DB_DIR / 'price_history.db'
    conn = sqlite3.connect(str(ph_db))
    conn.row_factory = sqlite3.Row

    tickers = conn.execute("""
        SELECT ticker, COUNT(*) as cnt
        FROM price_history
        WHERE date >= ? AND date <= ?
        GROUP BY ticker
        HAVING cnt >= 100
        ORDER BY ticker
    """, (start_date, end_date)).fetchall()

    print(f'📊 Found {len(tickers)} tickers')

    ticker_data = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date >= ? AND date <= ?
            ORDER BY date
        """, (t['ticker'], start_date, end_date)).fetchall()

        filtered = [r for r in rows if r['close_price'] and r['close_price'] > 0
                     and r['high_price'] and r['low_price'] and r['open_price']]
        if len(filtered) >= 100:
            ticker_data[t['ticker']] = filtered

    conn.close()
    print(f'✅ Loaded {len(ticker_data)} tickers')
    return ticker_data


# ═══════════════════════════════════════════════════════════════════════
# Strategy 1: Event-driven (تصحيحات حادة)
# ═══════════════════════════════════════════════════════════════════════

def generate_event_driven_signals(ticker_data, start_date, end_date):
    """
    شراء بعد تصحيح حاد:
      - نزل > 15% في 5 أيام
      - سيولة 50M+ EGP
      - Entry: next-day open
      - Exit: SL 5% / TGT 15% / 10 أيام
    """
    signals = []

    for ticker, hist in ticker_data.items():
        if len(hist) < DROP_WINDOW + EVENT_HOLDING + 5:
            continue

        closes = [r['close_price'] for r in hist]
        opens = [r['open_price'] for r in hist]
        highs = [r['high_price'] for r in hist]
        lows = [r['low_price'] for r in hist]
        volumes = [r['volume'] or 0 for r in hist]
        dates = [r['date'] for r in hist]

        for i in range(DROP_WINDOW + 5, len(closes) - EVENT_HOLDING - 3):
            if dates[i] < start_date or dates[i] > end_date:
                continue

            # فلتر السيولة
            avg_vol_20 = sum(volumes[max(0, i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < EVENT_MIN_TURNOVER:
                continue

            # شرط التصحيح: نزل > 15% في 5 أيام
            if i < DROP_WINDOW:
                continue
            drop_5d = ((closes[i] - closes[i - DROP_WINDOW]) / closes[i - DROP_WINDOW]) * 100
            if drop_5d > DROP_THRESHOLD:
                continue  # مش تصحيح حاد

            # Entry: next-day open
            entry_idx = i + 1
            if entry_idx >= len(closes):
                continue
            entry = opens[entry_idx]
            entry_date = dates[entry_idx]

            if entry <= 0:
                continue

            sl = entry * (1 - EVENT_SL_PCT / 100)
            target = entry * (1 + EVENT_TGT_PCT / 100)

            # Exit
            exit_price = None
            exit_date = None
            exit_reason = None
            exit_idx_max = min(entry_idx + EVENT_HOLDING, len(closes) - 1)

            for j in range(entry_idx + 1, exit_idx_max + 1):
                if lows[j] <= sl:
                    exit_price = sl
                    exit_date = dates[j]
                    exit_reason = 'STOP_LOSS'
                    break
                if highs[j] >= target:
                    exit_price = target
                    exit_date = dates[j]
                    exit_reason = 'TARGET'
                    break

            if exit_price is None:
                exit_price = closes[exit_idx_max]
                exit_date = dates[exit_idx_max]
                exit_reason = 'TIME_EXIT'

            gross_ret = ((exit_price - entry) / entry) * 100
            net_ret = gross_ret - COST_RT

            signals.append({
                'ticker': ticker,
                'signal_date': dates[i],
                'entry_date': entry_date,
                'exit_date': exit_date,
                'drop_5d': drop_5d,
                'entry_price': entry,
                'exit_price': exit_price,
                'net_return': net_ret,
                'exit_reason': exit_reason,
                'turnover': turnover,
            })

    return signals


# ═══════════════════════════════════════════════════════════════════════
# Strategy 2: Trend على EGX30 (50-day high breakout)
# ═══════════════════════════════════════════════════════════════════════

def generate_trend_egx30_signals(ticker_data, start_date, end_date):
    """
    Trend على EGX30 (COMI proxy):
      - شراء لو COMI اخترق أعلى 50 يوم
      - SL 4% / TGT 12% / 15 يوم
    """
    signals = []

    # COMI data
    comi_hist = ticker_data.get('COMI', [])
    if len(comi_hist) < TREND_LOOKBACK + TREND_HOLDING + 5:
        print(f'  ⚠️ COMI data insufficient: {len(comi_hist)} days')
        return signals

    closes = [r['close_price'] for r in comi_hist]
    opens = [r['open_price'] for r in comi_hist]
    highs = [r['high_price'] for r in comi_hist]
    lows = [r['low_price'] for r in comi_hist]
    dates = [r['date'] for r in comi_hist]

    for i in range(TREND_LOOKBACK + 5, len(closes) - TREND_HOLDING - 3):
        if dates[i] < start_date or dates[i] > end_date:
            continue

        # شرط الاختراق: close > max(high[-50:-1])
        high_50 = max(highs[i - TREND_LOOKBACK:i])
        if closes[i] <= high_50:
            continue

        # Entry: next-day open
        entry_idx = i + 1
        if entry_idx >= len(closes):
            continue
        entry = opens[entry_idx]
        entry_date = dates[entry_idx]

        if entry <= 0:
            continue

        sl = entry * (1 - TREND_SL_PCT / 100)
        target = entry * (1 + TREND_TGT_PCT / 100)

        # Exit
        exit_price = None
        exit_date = None
        exit_reason = None
        exit_idx_max = min(entry_idx + TREND_HOLDING, len(closes) - 1)

        for j in range(entry_idx + 1, exit_idx_max + 1):
            if lows[j] <= sl:
                exit_price = sl
                exit_date = dates[j]
                exit_reason = 'STOP_LOSS'
                break
            if highs[j] >= target:
                exit_price = target
                exit_date = dates[j]
                exit_reason = 'TARGET'
                break

        if exit_price is None:
            exit_price = closes[exit_idx_max]
            exit_date = dates[exit_idx_max]
            exit_reason = 'TIME_EXIT'

        gross_ret = ((exit_price - entry) / entry) * 100
        net_ret = gross_ret - COST_RT

        signals.append({
            'ticker': 'COMI',
            'signal_date': dates[i],
            'entry_date': entry_date,
            'exit_date': exit_date,
            'high_50': high_50,
            'close_at_signal': closes[i],
            'entry_price': entry,
            'exit_price': exit_price,
            'net_return': net_ret,
            'exit_reason': exit_reason,
        })

    return signals


# ═══════════════════════════════════════════════════════════════════════
# Null Model (random entries)
# ═══════════════════════════════════════════════════════════════════════

def generate_random_signals(ticker_data, start_date, end_date, n_target=100,
                              min_turnover=EVENT_MIN_TURNOVER, seed=42):
    """Null Model: random entries بـ نفس فلاتر السيولة"""
    np.random.seed(seed)

    all_signals = []
    for ticker, hist in ticker_data.items():
        if len(hist) < 60:
            continue

        closes = [r['close_price'] for r in hist]
        opens = [r['open_price'] for r in hist]
        highs = [r['high_price'] for r in hist]
        lows = [r['low_price'] for r in hist]
        volumes = [r['volume'] or 0 for r in hist]
        dates = [r['date'] for r in hist]

        for i in range(50, len(closes) - EVENT_HOLDING - 3):
            if dates[i] < start_date or dates[i] > end_date:
                continue

            avg_vol_20 = sum(volumes[max(0, i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < min_turnover:
                continue

            all_signals.append((ticker, i))

    if len(all_signals) > n_target:
        indices = np.random.choice(len(all_signals), n_target, replace=False)
        sampled = [all_signals[idx] for idx in indices]
    else:
        sampled = all_signals

    signals = []
    for ticker, i in sampled:
        hist = ticker_data[ticker]
        closes = [r['close_price'] for r in hist]
        opens = [r['open_price'] for r in hist]
        highs = [r['high_price'] for r in hist]
        lows = [r['low_price'] for r in hist]
        dates = [r['date'] for r in hist]

        entry_idx = i + 1
        if entry_idx >= len(closes):
            continue
        entry = opens[entry_idx]
        entry_date = dates[entry_idx]

        if entry <= 0:
            continue

        # نفس SL/TGT لـ event-driven (للـ comparison)
        sl = entry * (1 - EVENT_SL_PCT / 100)
        target = entry * (1 + EVENT_TGT_PCT / 100)

        exit_price = None
        exit_date = None
        exit_reason = None
        exit_idx_max = min(entry_idx + EVENT_HOLDING, len(closes) - 1)

        for j in range(entry_idx + 1, exit_idx_max + 1):
            if lows[j] <= sl:
                exit_price = sl
                exit_date = dates[j]
                exit_reason = 'STOP_LOSS'
                break
            if highs[j] >= target:
                exit_price = target
                exit_date = dates[j]
                exit_reason = 'TARGET'
                break

        if exit_price is None:
            exit_price = closes[exit_idx_max]
            exit_date = dates[exit_idx_max]
            exit_reason = 'TIME_EXIT'

        gross_ret = ((exit_price - entry) / entry) * 100
        net_ret = gross_ret - COST_RT

        signals.append({
            'ticker': ticker,
            'signal_date': dates[i],
            'entry_date': entry_date,
            'exit_date': exit_date,
            'entry_price': entry,
            'exit_price': exit_price,
            'net_return': net_ret,
            'exit_reason': exit_reason,
        })

    return signals


# ═══════════════════════════════════════════════════════════════════════
# Stats + p-value
# ═══════════════════════════════════════════════════════════════════════

def calc_stats(signals):
    if not signals:
        return None

    returns = [s['net_return'] for s in signals]
    positive = [r for r in returns if r > 0]
    negative = [abs(r) for r in returns if r < 0]

    n = len(returns)
    wins = len(positive)
    wr = wins / n * 100 if n > 0 else 0
    sum_pos = sum(positive)
    sum_neg = sum(negative)
    pf = sum_pos / sum_neg if sum_neg > 0 else 0

    exit_reasons = defaultdict(int)
    for s in signals:
        exit_reasons[s['exit_reason']] += 1

    return {
        'n': n,
        'wins': wins,
        'losses': n - wins,
        'win_rate': wr,
        'profit_factor': pf,
        'mean_return': float(np.mean(returns)),
        'median_return': float(np.median(returns)),
        'std_return': float(np.std(returns)),
        'total_return': sum(returns),
        'avg_win': float(np.mean(positive)) if positive else 0,
        'avg_loss': float(np.mean(negative)) if negative else 0,
        'exit_reasons': dict(exit_reasons),
    }


def null_model_pvalue(strategy_returns, null_returns):
    if not strategy_returns or not null_returns:
        return None

    strategy_mean = np.mean(strategy_returns)
    null_mean = np.mean(null_returns)

    n_better = sum(1 for r in null_returns if r > strategy_mean)
    p_value = n_better / len(null_returns) * 100

    return {
        'strategy_mean': float(strategy_mean),
        'null_mean': float(null_mean),
        'p_value': float(p_value),
        'edge': p_value < 5,
    }


# ═══════════════════════════════════════════════════════════════════════
# Test per period
# ═══════════════════════════════════════════════════════════════════════

def test_period(ticker_data, period_name, start_date, end_date):
    print(f"\n{'='*80}")
    print(f"  📊 Period: {period_name} ({start_date} → {end_date})")
    print(f"{'='*80}")

    # Event-driven
    event_signals = generate_event_driven_signals(ticker_data, start_date, end_date)
    print(f"  Event-driven signals: {len(event_signals)}")

    # Trend EGX30
    trend_signals = generate_trend_egx30_signals(ticker_data, start_date, end_date)
    print(f"  Trend EGX30 signals: {len(trend_signals)}")

    # Null Model
    n_null = max(len(event_signals), 100)
    null_signals = generate_random_signals(ticker_data, start_date, end_date,
                                              n_target=n_null, seed=42)
    print(f"  Null Model signals: {len(null_signals)}")

    # Stats
    event_stats = calc_stats(event_signals)
    trend_stats = calc_stats(trend_signals)
    null_stats = calc_stats(null_signals)

    if event_stats:
        print(f"\n  📈 Event-driven (تصحيحات حادة):")
        print(f"    n={event_stats['n']} | WR={event_stats['win_rate']:.1f}% | "
              f"PF={event_stats['profit_factor']:.2f} | mean={event_stats['mean_return']:+.2f}% | "
              f"total={event_stats['total_return']:+.2f}%")
        print(f"    Exit reasons: {event_stats['exit_reasons']}")

    if trend_stats:
        print(f"\n  📈 Trend EGX30 (50-day high breakout):")
        print(f"    n={trend_stats['n']} | WR={trend_stats['win_rate']:.1f}% | "
              f"PF={trend_stats['profit_factor']:.2f} | mean={trend_stats['mean_return']:+.2f}% | "
              f"total={trend_stats['total_return']:+.2f}%")
        print(f"    Exit reasons: {trend_stats['exit_reasons']}")

    if null_stats:
        print(f"\n  📊 Null Model:")
        print(f"    n={null_stats['n']} | WR={null_stats['win_rate']:.1f}% | "
              f"PF={null_stats['profit_factor']:.2f} | mean={null_stats['mean_return']:+.2f}%")

    # p-values
    if event_signals and null_signals:
        event_returns = [s['net_return'] for s in event_signals]
        null_returns = [s['net_return'] for s in null_signals]
        pv = null_model_pvalue(event_returns, null_returns)
        print(f"\n  🎯 Event-driven p-value: {pv['p_value']:.1f}% | "
              f"strategy={pv['strategy_mean']:+.2f}% vs null={pv['null_mean']:+.2f}%")
        if pv['edge']:
            print(f"  ✅ EDGE! (p < 5%)")
        else:
            print(f"  ❌ no edge (p >= 5%)")

    if trend_signals and null_signals:
        trend_returns = [s['net_return'] for s in trend_signals]
        null_returns = [s['net_return'] for s in null_signals]
        pv = null_model_pvalue(trend_returns, null_returns)
        print(f"\n  🎯 Trend EGX30 p-value: {pv['p_value']:.1f}% | "
              f"strategy={pv['strategy_mean']:+.2f}% vs null={pv['null_mean']:+.2f}%")
        if pv['edge']:
            print(f"  ✅ EDGE! (p < 5%)")
        else:
            print(f"  ❌ no edge (p >= 5%)")

    return {
        'period': period_name,
        'start_date': start_date,
        'end_date': end_date,
        'event_driven': event_stats,
        'trend_egx30': trend_stats,
        'null_model': null_stats,
        'event_p_value': null_model_pvalue(
            [s['net_return'] for s in event_signals],
            [s['net_return'] for s in null_signals]) if event_signals and null_signals else None,
        'trend_p_value': null_model_pvalue(
            [s['net_return'] for s in trend_signals],
            [s['net_return'] for s in null_signals]) if trend_signals and null_signals else None,
    }


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

def main():
    print(f"\n{'#'*80}")
    print(f"  🔬 EVENT-DRIVEN + TREND EGX30 TEST")
    print(f"{'#'*80}")
    print(f"\n  Event-driven: drop > {abs(DROP_THRESHOLD)}% in {DROP_WINDOW}d | "
          f"SL={EVENT_SL_PCT}% | TGT={EVENT_TGT_PCT}% | Hold={EVENT_HOLDING}d | "
          f"MinTurnover={EVENT_MIN_TURNOVER/1e6:.0f}M")
    print(f"  Trend EGX30: {TREND_LOOKBACK}-day high breakout | "
          f"SL={TREND_SL_PCT}% | TGT={TREND_TGT_PCT}% | Hold={TREND_HOLDING}d")
    print(f"  Cost: {COST_RT}% round-trip")

    ticker_data = load_ticker_data(start_date='2024-01-01', end_date='2026-10-18')

    results = []
    results.append(test_period(ticker_data, '2024', '2024-01-01', '2024-12-31'))
    results.append(test_period(ticker_data, '2025', '2025-01-01', '2025-12-31'))
    results.append(test_period(ticker_data, '2026', '2026-01-01', '2026-10-18'))

    # Final summary
    print(f"\n{'='*110}")
    print(f"  🎯 FINAL SUMMARY — Event-driven + Trend EGX30")
    print(f"{'='*110}")
    print(f"\n  {'Period':10s} | {'Strategy':15s} | {'N':>5} | {'WR':>6} | {'PF':>6} | {'Mean':>8} | {'Null Mean':>9} | {'p-value':>8} | {'Edge?':>6}")
    print(f"  {'-'*100}")

    for r in results:
        # Event-driven row
        ev = r.get('event_driven') or {}
        null = r.get('null_model') or {}
        ev_pv = r.get('event_p_value') or {}

        ev_n = ev.get('n', 0)
        ev_wr = f"{ev.get('win_rate', 0):.1f}%" if ev else 'N/A'
        ev_pf = f"{ev.get('profit_factor', 0):.2f}" if ev else 'N/A'
        ev_mean = f"{ev.get('mean_return', 0):+.2f}%" if ev else 'N/A'
        null_mean = f"{null.get('mean_return', 0):+.2f}%" if null else 'N/A'
        ev_p = f"{ev_pv.get('p_value', 0):.1f}%" if ev_pv else 'N/A'
        ev_edge = '✅' if ev_pv.get('edge') else '❌'

        print(f"  {r['period']:10s} | {'Event-driven':15s} | {ev_n:>5} | {ev_wr:>6} | {ev_pf:>6} | {ev_mean:>8} | {null_mean:>9} | {ev_p:>8} | {ev_edge:>6}")

        # Trend row
        tr = r.get('trend_egx30') or {}
        tr_pv = r.get('trend_p_value') or {}

        tr_n = tr.get('n', 0)
        tr_wr = f"{tr.get('win_rate', 0):.1f}%" if tr else 'N/A'
        tr_pf = f"{tr.get('profit_factor', 0):.2f}" if tr else 'N/A'
        tr_mean = f"{tr.get('mean_return', 0):+.2f}%" if tr else 'N/A'
        tr_p = f"{tr_pv.get('p_value', 0):.1f}%" if tr_pv else 'N/A'
        tr_edge = '✅' if tr_pv.get('edge') else '❌'

        print(f"  {r['period']:10s} | {'Trend EGX30':15s} | {tr_n:>5} | {tr_wr:>6} | {tr_pf:>6} | {tr_mean:>8} | {null_mean:>9} | {tr_p:>8} | {tr_edge:>6}")

    print(f"\n{'='*110}")

    # حفظ JSON
    output_path = PROJECT / 'vps-service' / 'backtest_results' / f'event_trend_egx30_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'config': {
                'event_driven': {
                    'drop_threshold': DROP_THRESHOLD,
                    'drop_window': DROP_WINDOW,
                    'min_turnover': EVENT_MIN_TURNOVER,
                    'sl_pct': EVENT_SL_PCT,
                    'tgt_pct': EVENT_TGT_PCT,
                    'holding': EVENT_HOLDING,
                },
                'trend_egx30': {
                    'lookback': TREND_LOOKBACK,
                    'sl_pct': TREND_SL_PCT,
                    'tgt_pct': TREND_TGT_PCT,
                    'holding': TREND_HOLDING,
                },
                'cost_rt': COST_RT,
            },
            'results': results,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 JSON saved: {output_path}")


if __name__ == '__main__':
    main()
