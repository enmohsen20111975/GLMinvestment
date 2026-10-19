#!/usr/bin/env python3
"""
backtest_hybrid_v2.py — Backtest حقيقي للنظام الهجين على تاريخ سابق

المنطق (محسن: "التجربة خير برهان"):
  1. خد تاريخ سابق (مثلاً 2026-09-18 — شهر فات)
  2. شغل النظام الهجين على كل الأسهم AS OF THAT DATE (Point-in-Time)
  3. سجّل التوصيات (BUY/STRONG_BUY/HOLD/REDUCE/SELL)
  4. قِيس العوائد الفعلية بعد 5/10/21 يوم
  5. قارن بـ Null Model (random entries نفس الفترة)
  6. احسب p-value

الـ tests:
  - Hybrid v2 (BUY + STRONG_BUY) vs Null Model
  - Breakout (20-day high) vs Null Model
  - Breakout + Hybrid Filter (veto على SELL/REDUCE) vs Null Model
  - مقارنة الـ 3 strategies

Author: BRAVO-QUANT — 2026-10-19
"""
import sys
import os
import sqlite3
import json
import warnings
import numpy as np
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

warnings.filterwarnings('ignore')

PROJECT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT / 'db'
sys.path.insert(0, str(PROJECT / 'scripts'))
sys.path.insert(0, str(PROJECT / 'vps-service'))

from hybrid_stage_analyzer_v2 import (
    analyze_stock_hybrid_v2, layer1_hmm_market_regime_v2
)
# breakout detection (محلي — مش مستورد)
def detect_breakout_signal(closes, highs, volumes, idx):
    """كشف breakout (20-day high) — Point-in-Time"""
    if idx < 20 or idx >= len(closes):
        return False
    high_20 = max(highs[idx-20:idx])
    return closes[idx] > high_20


def load_all_tickers_data(start_date='2026-01-01', end_date='2026-10-18'):
    """تحميل بيانات كل الأسهم"""
    ph_db = DB_DIR / 'price_history.db'
    conn = sqlite3.connect(str(ph_db))
    conn.row_factory = sqlite3.Row

    # كل tickers لهم data في الفترة
    tickers = conn.execute("""
        SELECT ticker, COUNT(*) as cnt, MIN(date) as min_date, MAX(date) as max_date
        FROM price_history
        WHERE date >= ? AND date <= ?
        GROUP BY ticker
        HAVING cnt >= 150
        ORDER BY ticker
    """, (start_date, end_date)).fetchall()

    print(f'📊 Found {len(tickers)} tickers with data {start_date} → {end_date}')

    # تحميل كل ticker data
    ticker_data = {}
    for t in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date >= ? AND date <= ?
            ORDER BY date
        """, (t['ticker'], start_date, end_date)).fetchall()

        # فلتر NaN
        filtered = [r for r in rows if r['close_price'] and r['close_price'] > 0
                     and r['high_price'] and r['low_price'] and r['open_price']]
        if len(filtered) >= 250:
            ticker_data[t['ticker']] = filtered

    conn.close()
    print(f'✅ Loaded data for {len(ticker_data)} tickers')
    return ticker_data


def get_data_as_of(ticker_data, ticker, as_of_date):
    """خد بيانات ticker حتى تاريخ معين (Point-in-Time)"""
    rows = ticker_data.get(ticker, [])
    data_as_of = [r for r in rows if r['date'] <= as_of_date]
    return data_as_of


def get_forward_returns(ticker_data, ticker, signal_date, periods=[5, 10, 21]):
    """حساب العوائد الفعلية بعد 5/10/21 يوم من signal_date"""
    rows = ticker_data.get(ticker, [])
    signal_idx = None
    for i, r in enumerate(rows):
        if r['date'] >= signal_date:
            signal_idx = i
            break

    if signal_idx is None:
        return None

    entry_price = rows[signal_idx]['close_price']
    if not entry_price or entry_price <= 0:
        return None

    returns = {}
    for period in periods:
        exit_idx = signal_idx + period
        if exit_idx < len(rows):
            exit_price = rows[exit_idx]['close_price']
            if exit_price and exit_price > 0:
                returns[f'ret_{period}d'] = ((exit_price - entry_price) / entry_price) * 100
            else:
                returns[f'ret_{period}d'] = None
        else:
            returns[f'ret_{period}d'] = None

    return returns


def backtest_strategy(ticker_data, signal_date, strategy='hybrid_v2',
                       holding_days=10, min_days=200):
    """
    backtest استراتيجية معينة على signal_date.

    strategies:
      - 'hybrid_v2': Hybrid v2 (BUY + STRONG_BUY)
      - 'breakout': Breakout (20-day high)
      - 'breakout_filtered': Breakout + Hybrid v2 filter (veto على SELL/REDUCE)
      - 'null': Random entries (للـ comparison)
    """
    print(f"\n{'='*80}")
    print(f"  📊 Backtest: {strategy} | signal_date={signal_date} | holding={holding_days}d")
    print(f"{'='*80}")

    # Market context as of signal_date
    egx_data = ticker_data.get('COMI', [])
    egx_as_of = [r for r in egx_data if r['date'] <= signal_date]
    egx_closes = [r['close_price'] for r in egx_as_of if r['close_price'] and r['close_price'] > 0]

    # تحميل market context
    from hybrid_stage_analyzer_v2 import layer1_hmm_market_regime_v2
    if len(egx_closes) >= 100:
        mc = layer1_hmm_market_regime_v2(egx_closes, lookback=504)
        mc['veto_buy'] = (mc['regime'] == 'BEAR' and mc['confidence'] > 70)
    else:
        mc = {'regime': 'UNKNOWN', 'confidence': 0, 'veto_buy': False, 'method': 'no_data'}

    print(f"  Market Context (EGX30 as of {signal_date}): {mc['regime']} ({mc['confidence']:.0f}%) | veto={mc['veto_buy']}")

    # استراتيجيات
    signals = []  # list of {ticker, signal_date, strategy_info}

    tickers_scanned = 0
    tickers_with_signal = 0

    for ticker, rows in ticker_data.items():
        # خد data as of signal_date
        data_as_of = [r for r in rows if r['date'] <= signal_date]
        if len(data_as_of) < min_days:
            continue

        tickers_scanned += 1

        closes = [r['close_price'] for r in data_as_of if r['close_price'] and r['close_price'] > 0]
        highs = [r['high_price'] for r in data_as_of if r['high_price'] and r['high_price'] > 0]
        lows = [r['low_price'] for r in data_as_of if r['low_price'] and r['low_price'] > 0]
        volumes = [r['volume'] or 0 for r in data_as_of]

        if len(closes) < min_days:
            continue

        # استخرج signal_date فعلي (أقرب يوم تداول)
        actual_signal_date = data_as_of[-1]['date']

        # تنفيذ الاستراتيجية
        triggered = False
        signal_info = {}

        if strategy == 'hybrid_v2':
            # Hybrid v2: BUY + STRONG_BUY
            try:
                analysis = analyze_stock_hybrid_v2(closes, highs, lows, volumes,
                                                     ticker=ticker, market_context=mc)
                if analysis['recommendation'] in ('BUY', 'STRONG_BUY'):
                    triggered = True
                    signal_info = {
                        'score': analysis['hybrid_score'],
                        'recommendation': analysis['recommendation'],
                    }
            except Exception:
                pass

        elif strategy == 'breakout':
            # Breakout: 20-day high
            if detect_breakout_signal(closes, highs, volumes, len(closes) - 1):
                triggered = True
                signal_info = {'breakout': True}

        elif strategy == 'breakout_filtered':
            # Breakout + Hybrid v2 filter (veto على SELL/REDUCE)
            if detect_breakout_signal(closes, highs, volumes, len(closes) - 1):
                # طبق Hybrid v2 filter
                try:
                    analysis = analyze_stock_hybrid_v2(closes, highs, lows, volumes,
                                                         ticker=ticker, market_context=mc)
                    if analysis['recommendation'] not in ('SELL', 'REDUCE'):
                        triggered = True
                        signal_info = {
                            'breakout': True,
                            'hybrid_score': analysis['hybrid_score'],
                            'hybrid_rec': analysis['recommendation'],
                        }
                except Exception:
                    # لو الـ hybrid فشل، اقبل الـ breakout
                    triggered = True
                    signal_info = {'breakout': True, 'hybrid_filter': 'failed'}

        elif strategy == 'null':
            # Random: 10% احتمال لاي ticker
            np.random.seed(hash(ticker + signal_date) % 2**31)
            if np.random.random() < 0.10:  # 10% من الأسهم
                triggered = True
                signal_info = {'random': True}

        if triggered:
            # حساب forward returns
            forward = get_forward_returns(ticker_data, ticker, actual_signal_date)
            if forward:
                signal_info['ticker'] = ticker
                signal_info['signal_date'] = actual_signal_date
                signal_info.update(forward)
                signals.append(signal_info)
                tickers_with_signal += 1

    print(f"\n  Scanned: {tickers_scanned} tickers")
    print(f"  Signals: {tickers_with_signal}")

    if not signals:
        return {
            'strategy': strategy,
            'signal_date': signal_date,
            'holding_days': holding_days,
            'n_signals': 0,
            'error': 'no signals',
        }

    # حساب الإحصائيات
    ret_5d = [s['ret_5d'] for s in signals if s.get('ret_5d') is not None]
    ret_10d = [s['ret_10d'] for s in signals if s.get('ret_10d') is not None]
    ret_21d = [s['ret_21d'] for s in signals if s.get('ret_21d') is not None]

    def stats(returns):
        if not returns:
            return None
        return {
            'n': len(returns),
            'mean': float(np.mean(returns)),
            'median': float(np.median(returns)),
            'std': float(np.std(returns)),
            'win_rate': float(sum(1 for r in returns if r > 0) / len(returns) * 100),
            'profit_factor': float(
                sum(r for r in returns if r > 0) / abs(sum(r for r in returns if r < 0))
                if any(r < 0 for r in returns) else 999
            ),
        }

    result = {
        'strategy': strategy,
        'signal_date': signal_date,
        'holding_days': holding_days,
        'market_context': mc,
        'n_signals': len(signals),
        'stats_5d': stats(ret_5d),
        'stats_10d': stats(ret_10d),
        'stats_21d': stats(ret_21d),
        'signals_sample': signals[:20],  # sample للـ debug
    }

    # طباعة النتائج
    print(f"\n  📈 Results ({strategy}):")
    for period_label, stats_dict in [('5d', result['stats_5d']),
                                       ('10d', result['stats_10d']),
                                       ('21d', result['stats_21d'])]:
        if stats_dict:
            print(f"    {period_label}: n={stats_dict['n']} | mean={stats_dict['mean']:+.2f}% | "
                  f"median={stats_dict['median']:+.2f}% | WR={stats_dict['win_rate']:.1f}% | "
                  f"PF={stats_dict['profit_factor']:.2f}")

    return result


def null_model_pvalue(strategy_returns, null_returns):
    """
    حساب p-value: % من null أحسن من الـ strategy.
    p < 5% = edge حقيقي.
    """
    if not strategy_returns or not null_returns:
        return None

    strategy_mean = np.mean(strategy_returns)
    null_mean = np.mean(null_returns)

    # p-value: % من null entries أحسن من strategy mean
    n_better = sum(1 for r in null_returns if r > strategy_mean)
    p_value = n_better / len(null_returns) * 100

    return {
        'strategy_mean': float(strategy_mean),
        'null_mean': float(null_mean),
        'p_value': float(p_value),
        'edge': p_value < 5,
    }


def run_full_comparison(ticker_data, signal_date, holding_days=10):
    """تشغيل كل الـ 4 استراتيجيات + مقارنة"""
    print(f"\n{'#'*80}")
    print(f"  🎯 FULL COMPARISON — signal_date={signal_date} | holding={holding_days}d")
    print(f"{'#'*80}")

    strategies = ['hybrid_v2', 'breakout', 'breakout_filtered', 'null']
    results = {}

    for strat in strategies:
        results[strat] = backtest_strategy(ticker_data, signal_date, strategy=strat,
                                             holding_days=holding_days)

    # مقارنة النتائج
    print(f"\n{'='*100}")
    print(f"  📊 COMPARISON TABLE — signal_date={signal_date} | holding={holding_days}d")
    print(f"{'='*100}")
    print(f"\n  {'Strategy':20s} | {'N':>4} | {'Mean 5d':>8} | {'Mean 10d':>9} | {'Mean 21d':>9} | {'WR 10d':>7} | {'PF 10d':>7}")
    print(f"  {'-'*85}")

    for strat in strategies:
        r = results[strat]
        if 'error' in r:
            print(f"  {strat:20s} | {'N/A':>4} | {'N/A':>8} | {'N/A':>9} | {'N/A':>9} | {'N/A':>7} | {'N/A':>7}")
            continue
        s5 = r.get('stats_5d') or {}
        s10 = r.get('stats_10d') or {}
        s21 = r.get('stats_21d') or {}
        n = r['n_signals']
        m5 = f"{s5.get('mean', 0):+.2f}%" if s5 else 'N/A'
        m10 = f"{s10.get('mean', 0):+.2f}%" if s10 else 'N/A'
        m21 = f"{s21.get('mean', 0):+.2f}%" if s21 else 'N/A'
        wr10 = f"{s10.get('win_rate', 0):.1f}%" if s10 else 'N/A'
        pf10 = f"{s10.get('profit_factor', 0):.2f}" if s10 else 'N/A'
        print(f"  {strat:20s} | {n:>4} | {m5:>8} | {m10:>9} | {m21:>9} | {wr10:>7} | {pf10:>7}")

    # p-value calculations (Hybrid + Breakout vs Null)
    null_returns = []
    null_result = results.get('null', {})
    if null_result and null_result.get('signals_sample'):
        null_returns = [s['ret_10d'] for s in null_result['signals_sample'] if s.get('ret_10d') is not None]

    if null_returns:
        print(f"\n  📊 p-value Calculations (vs Null Model):")

        for strat in ['hybrid_v2', 'breakout', 'breakout_filtered']:
            r = results.get(strat, {})
            if 'error' in r or not r.get('signals_sample'):
                print(f"    {strat:20s}: no signals")
                continue
            strat_returns = [s['ret_10d'] for s in r['signals_sample'] if s.get('ret_10d') is not None]
            if not strat_returns:
                print(f"    {strat:20s}: no returns")
                continue
            pv = null_model_pvalue(strat_returns, null_returns)
            edge = '✅ EDGE' if pv['edge'] else '❌ NO EDGE'
            print(f"    {strat:20s}: mean={pv['strategy_mean']:+.2f}% | null={pv['null_mean']:+.2f}% | "
                  f"p-value={pv['p_value']:.1f}% | {edge}")

    return results


# ═══════════════════════════════════════════════════════════════════════
# Main
# ═══════════════════════════════════════════════════════════════════════

if __name__ == '__main__':
    import argparse
    parser = argparse.ArgumentParser(description='Backtest Hybrid v2 on historical date')
    parser.add_argument('--signal-date', default='2026-09-18', help='Signal date (YYYY-MM-DD)')
    parser.add_argument('--holding-days', type=int, default=10, help='Holding period')
    parser.add_argument('--start-date', default='2025-01-01', help='Data start date')
    parser.add_argument('--end-date', default='2026-10-18', help='Data end date')
    parser.add_argument('--json', action='store_true', help='Save JSON')
    args = parser.parse_args()

    print(f"\n{'#'*80}")
    print(f"  🔬 BACKTEST HYBRID v2 — 'التجربة خير برهان'")
    print(f"  Signal Date: {args.signal_date}")
    print(f"  Holding Days: {args.holding_days}")
    print(f"  Data Range: {args.start_date} → {args.end_date}")
    print(f"{'#'*80}")

    # تحميل البيانات
    ticker_data = load_all_tickers_data(start_date=args.start_date, end_date=args.end_date)

    # تشغيل المقارنة الكاملة
    results = run_full_comparison(ticker_data, args.signal_date, args.holding_days)

    # حفظ JSON
    if args.json:
        output_path = PROJECT / 'vps-service' / 'backtest_results' / f'backtest_hybrid_{args.signal_date}_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
        output_path.parent.mkdir(exist_ok=True)
        with open(output_path, 'w', encoding='utf-8') as f:
            json.dump({
                'generated_at': datetime.now().isoformat(),
                'signal_date': args.signal_date,
                'holding_days': args.holding_days,
                'data_range': [args.start_date, args.end_date],
                'results': results,
            }, f, indent=2, ensure_ascii=False, default=str)
        print(f"\n💾 JSON saved: {output_path}")

    # خلاصة نهائية
    print(f"\n{'='*100}")
    print(f"  🎯 FINAL VERDICT")
    print(f"{'='*100}")

    null_r = results.get('null', {})
    null_returns = []
    if null_r and null_r.get('signals_sample'):
        null_returns = [s['ret_10d'] for s in null_r['signals_sample'] if s.get('ret_10d') is not None]

    for strat in ['hybrid_v2', 'breakout', 'breakout_filtered']:
        r = results.get(strat, {})
        if 'error' in r or not r.get('signals_sample'):
            print(f"  {strat:20s}: ❌ no signals")
            continue
        strat_returns = [s['ret_10d'] for s in r['signals_sample'] if s.get('ret_10d') is not None]
        if not strat_returns or not null_returns:
            print(f"  {strat:20s}: ❌ insufficient data")
            continue
        pv = null_model_pvalue(strat_returns, null_returns)
        edge = '✅ EDGE' if pv['edge'] else '❌ NO EDGE'
        s10 = r.get('stats_10d') or {}
        print(f"  {strat:20s}: n={len(strat_returns)} | mean={pv['strategy_mean']:+.2f}% | "
              f"WR={s10.get('win_rate', 0):.1f}% | PF={s10.get('profit_factor', 0):.2f} | "
              f"p-value={pv['p_value']:.1f}% | {edge}")

    print(f"\n{'='*100}")
