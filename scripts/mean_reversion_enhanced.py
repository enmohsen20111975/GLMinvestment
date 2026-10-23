#!/usr/bin/env python3
"""
mean_reversion_enhanced.py — اختبار Mean Reversion محسّن

بناءً على خطة محسن:
  - Mean Reversion على أسهم عالية السيولة (فلتر 20M+ EGP)
  - RSI < 30
  - وقف خسارة 2%
  - هدف 5%
  - فترة احتفاظ 5 أيام

الاختبار:
  - على 2024 و 2025 و 2026 بشكل منفصل
  - Null Model لكل فترة (p-value < 5% = edge)
  - Walk-Forward (optional)
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
# Config
# ═══════════════════════════════════════════════════════════════════════

SL_PCT = 2.0           # وقف خسارة 2% (محسن من 3%)
TARGET_PCT = 5.0       # هدف 5% (محسن من 10%)
HOLDING_DAYS = 5       # فترة احتفاظ 5 أيام
MIN_TURNOVER_EGP = 20_000_000  # فلتر سيولة 20M EGP (محسن من 5M)
RSI_THRESHOLD = 30     # RSI < 30
RSI_PERIOD = 14
COST_RT = 1.0          # تكاليف round-trip 1%
N_NULL_SIMS = 100      # عدد محاكاة Null Model


# ═══════════════════════════════════════════════════════════════════════
# Indicators
# ═══════════════════════════════════════════════════════════════════════

def calc_rsi(closes, period=14):
    """RSI(14)"""
    if len(closes) < period + 1:
        return None
    gains, losses = [], []
    for i in range(-period, 0):
        change = closes[i] - closes[i - 1]
        gains.append(max(0, change))
        losses.append(max(0, -change))
    avg_gain = sum(gains) / period
    avg_loss = sum(losses) / period
    if avg_loss == 0:
        return 100.0
    return 100 - (100 / (1 + avg_gain / avg_loss))


def calc_regime(closes, idx):
    """BULL / BEAR / RANGE"""
    if idx < 50:
        return 'RANGE'
    ma20 = sum(closes[idx-20:idx+1]) / 21
    ma50 = sum(closes[idx-50:idx+1]) / 51
    roc20 = (closes[idx] - closes[idx-20]) / closes[idx-20] * 100 if closes[idx-20] > 0 else 0
    if ma20 > ma50 * 1.02 and roc20 > 2:
        return 'BULL'
    elif ma20 < ma50 * 0.98 and roc20 < -2:
        return 'BEAR'
    return 'RANGE'


# ═══════════════════════════════════════════════════════════════════════
# Mean Reversion Signal Generation
# ═══════════════════════════════════════════════════════════════════════

def generate_mean_reversion_signals(ticker_data, start_date, end_date,
                                      min_turnover=MIN_TURNOVER_EGP):
    """
    توليد إشارات Mean Reversion.

    الشروط:
      1. RSI(14) < 30 (تشبع بيعي)
      2. سيولة: avg_vol_20 * close >= 20M EGP
      3. Regime: BULL أو RANGE (skip BEAR)
      4. Entry: next-day open (لا lookahead)
      5. Exit: SL 2% OR Target 5% OR 5 days (SL أولاً)
    """
    signals = []

    for ticker, hist in ticker_data.items():
        if len(hist) < 60:
            continue

        closes = [r['close_price'] for r in hist]
        opens = [r['open_price'] for r in hist]
        highs = [r['high_price'] for r in hist]
        lows = [r['low_price'] for r in hist]
        volumes = [r['volume'] or 0 for r in hist]
        dates = [r['date'] for r in hist]

        for i in range(50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < start_date or dates[i] > end_date:
                continue

            # فلتر السيولة
            avg_vol_20 = sum(volumes[max(0, i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < min_turnover:
                continue

            # فلتر Regime
            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue

            # شرط الإشارة: RSI < 30
            rsi_val = calc_rsi(closes[:i+1])
            if rsi_val is None or rsi_val >= RSI_THRESHOLD:
                continue

            # Entry: next-day open (لا lookahead)
            entry_idx = i + 1
            if entry_idx >= len(closes):
                continue
            entry = opens[entry_idx]
            entry_date = dates[entry_idx]

            if entry <= 0:
                continue

            sl = entry * (1 - SL_PCT / 100)
            target = entry * (1 + TARGET_PCT / 100)

            # Exit: SL أولاً (conservative)
            exit_price = None
            exit_date = None
            exit_reason = None
            exit_idx_max = min(entry_idx + HOLDING_DAYS, len(closes) - 1)

            for j in range(entry_idx + 1, exit_idx_max + 1):
                # SL check (low <= SL)
                if lows[j] <= sl:
                    exit_price = sl
                    exit_date = dates[j]
                    exit_reason = 'STOP_LOSS'
                    break
                # Target check (high >= target)
                if highs[j] >= target:
                    exit_price = target
                    exit_date = dates[j]
                    exit_reason = 'TARGET'
                    break

            if exit_price is None:
                exit_price = closes[exit_idx_max]
                exit_date = dates[exit_idx_max]
                exit_reason = 'TIME_EXIT'

            # العائد الصافي بعد التكاليف
            gross_ret = ((exit_price - entry) / entry) * 100
            net_ret = gross_ret - COST_RT

            signals.append({
                'ticker': ticker,
                'signal_date': dates[i],
                'entry_date': entry_date,
                'exit_date': exit_date,
                'rsi_at_signal': rsi_val,
                'regime': regime,
                'entry_price': entry,
                'exit_price': exit_price,
                'net_return': net_ret,
                'exit_reason': exit_reason,
                'turnover': turnover,
                'sector': 'UNKNOWN',  # لو محتاجين sector
            })

    return signals


def generate_random_signals(ticker_data, start_date, end_date,
                              min_turnover=MIN_TURNOVER_EGP,
                              n_target=100, seed=42):
    """توليد إشارات عشوائية (Null Model) — نفس الفلاتر، entry عشوائي"""
    np.random.seed(seed)

    # كل الإشارات الممكنة (نفس الفلاتر بس بدون RSI)
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

        for i in range(50, len(closes) - HOLDING_DAYS - 3):
            if dates[i] < start_date or dates[i] > end_date:
                continue

            avg_vol_20 = sum(volumes[max(0, i-20):i]) / 20 if i >= 20 else 0
            turnover = avg_vol_20 * closes[i]
            if turnover < min_turnover:
                continue

            regime = calc_regime(closes, i)
            if regime == 'BEAR':
                continue

            all_signals.append((ticker, i))

    # sample عشوائي
    if len(all_signals) > n_target:
        indices = np.random.choice(len(all_signals), n_target, replace=False)
        sampled = [all_signals[idx] for idx in indices]
    else:
        sampled = all_signals

    # بناء signals
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

        sl = entry * (1 - SL_PCT / 100)
        target = entry * (1 + TARGET_PCT / 100)

        exit_price = None
        exit_date = None
        exit_reason = None
        exit_idx_max = min(entry_idx + HOLDING_DAYS, len(closes) - 1)

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
# Stats
# ═══════════════════════════════════════════════════════════════════════

def calc_stats(signals):
    """حساب إحصائيات"""
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

    # exit reasons
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
    """p-value: % من null أحسن من strategy mean"""
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
# Load data
# ═══════════════════════════════════════════════════════════════════════

def load_ticker_data(start_date='2024-01-01', end_date='2026-10-18'):
    """تحميل بيانات كل الأسهم"""
    ph_db = DB_DIR / 'price_history.db'
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(ph_db), writable=False).__enter__()
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
    print(f'✅ Loaded {len(ticker_data)} tickers with sufficient data')
    return ticker_data


# ═══════════════════════════════════════════════════════════════════════
# Main test
# ═══════════════════════════════════════════════════════════════════════

def test_period(ticker_data, period_name, start_date, end_date):
    """اختبار Mean Reversion على فترة معينة"""
    print(f"\n{'='*80}")
    print(f"  📊 Period: {period_name} ({start_date} → {end_date})")
    print(f"{'='*80}")

    # Mean Reversion signals
    mr_signals = generate_mean_reversion_signals(ticker_data, start_date, end_date)
    print(f"  Mean Reversion signals: {len(mr_signals)}")

    # Null Model signals (نفس العدد)
    n_null = max(len(mr_signals), 100)
    null_signals = generate_random_signals(ticker_data, start_date, end_date,
                                              n_target=n_null, seed=42)
    print(f"  Null Model signals: {len(null_signals)}")

    # Stats
    mr_stats = calc_stats(mr_signals)
    null_stats = calc_stats(null_signals)

    if mr_stats:
        print(f"\n  📈 Mean Reversion:")
        print(f"    n={mr_stats['n']} | WR={mr_stats['win_rate']:.1f}% | "
              f"PF={mr_stats['profit_factor']:.2f} | mean={mr_stats['mean_return']:+.2f}% | "
              f"total={mr_stats['total_return']:+.2f}%")
        print(f"    Exit reasons: {mr_stats['exit_reasons']}")

    if null_stats:
        print(f"\n  📊 Null Model:")
        print(f"    n={null_stats['n']} | WR={null_stats['win_rate']:.1f}% | "
              f"PF={null_stats['profit_factor']:.2f} | mean={null_stats['mean_return']:+.2f}% | "
              f"total={null_stats['total_return']:+.2f}%")

    # p-value
    pv = None
    if mr_signals and null_signals:
        mr_returns = [s['net_return'] for s in mr_signals]
        null_returns = [s['net_return'] for s in null_signals]
        pv = null_model_pvalue(mr_returns, null_returns)

        print(f"\n  🎯 p-value: {pv['p_value']:.1f}% | "
              f"strategy={pv['strategy_mean']:+.2f}% vs null={pv['null_mean']:+.2f}%")
        if pv['edge']:
            print(f"  ✅ EDGE! (p < 5%)")
        else:
            print(f"  ❌ no edge (p >= 5%)")

    return {
        'period': period_name,
        'start_date': start_date,
        'end_date': end_date,
        'mean_reversion': mr_stats,
        'null_model': null_stats,
        'p_value': pv,
    }


def main():
    print(f"\n{'#'*80}")
    print(f"  🔬 MEAN REVERSION ENHANCED TEST — 'التجربة خير برهان'")
    print(f"  Config: RSI<{RSI_THRESHOLD} | SL={SL_PCT}% | TGT={TARGET_PCT}% | "
          f"Hold={HOLDING_DAYS}d | MinTurnover={MIN_TURNOVER_EGP/1e6:.0f}M EGP | Cost={COST_RT}%")
    print(f"{'#'*80}")

    # تحميل البيانات (من 2024 لـ 2026 عشان نـtest 3 فترات)
    ticker_data = load_ticker_data(start_date='2024-01-01', end_date='2026-10-18')

    # اختبار 3 فترات منفصلة
    results = []
    results.append(test_period(ticker_data, '2024', '2024-01-01', '2024-12-31'))
    results.append(test_period(ticker_data, '2025', '2025-01-01', '2025-12-31'))
    results.append(test_period(ticker_data, '2026', '2026-01-01', '2026-10-18'))

    # ملخص نهائي
    print(f"\n{'='*100}")
    print(f"  🎯 FINAL SUMMARY — Mean Reversion Enhanced")
    print(f"{'='*100}")
    print(f"\n  {'Period':10s} | {'MR n':>5} | {'MR WR':>6} | {'MR PF':>6} | {'MR mean':>8} | "
          f"{'Null n':>6} | {'Null mean':>9} | {'p-value':>8} | {'Edge?':>6}")
    print(f"  {'-'*100}")

    for r in results:
        mr = r.get('mean_reversion') or {}
        null = r.get('null_model') or {}
        pv = r.get('p_value') or {}

        mr_n = mr.get('n', 0)
        mr_wr = f"{mr.get('win_rate', 0):.1f}%" if mr else 'N/A'
        mr_pf = f"{mr.get('profit_factor', 0):.2f}" if mr else 'N/A'
        mr_mean = f"{mr.get('mean_return', 0):+.2f}%" if mr else 'N/A'
        null_n = null.get('n', 0)
        null_mean = f"{null.get('mean_return', 0):+.2f}%" if null else 'N/A'
        p_val = f"{pv.get('p_value', 0):.1f}%" if pv else 'N/A'
        edge = '✅' if pv.get('edge') else '❌'

        print(f"  {r['period']:10s} | {mr_n:>5} | {mr_wr:>6} | {mr_pf:>6} | {mr_mean:>8} | "
              f"{null_n:>6} | {null_mean:>9} | {p_val:>8} | {edge:>6}")

    print(f"\n{'='*100}")

    # حفظ JSON
    output_path = PROJECT / 'vps-service' / 'backtest_results' / f'mean_reversion_enhanced_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    output_path.parent.mkdir(exist_ok=True)
    with open(output_path, 'w', encoding='utf-8') as f:
        json.dump({
            'generated_at': datetime.now().isoformat(),
            'config': {
                'sl_pct': SL_PCT,
                'target_pct': TARGET_PCT,
                'holding_days': HOLDING_DAYS,
                'min_turnover_egp': MIN_TURNOVER_EGP,
                'rsi_threshold': RSI_THRESHOLD,
                'cost_rt': COST_RT,
            },
            'results': results,
        }, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n💾 JSON saved: {output_path}")


if __name__ == '__main__':
    main()
