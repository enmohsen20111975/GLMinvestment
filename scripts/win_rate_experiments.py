#!/usr/bin/env python3
"""
Win Rate Experiments — تجارب لرفع النسبة فوق 61.9%
=====================================================
نجرب комбينات مختلفة:
1. min_conviction من 5 لـ 8
2. إضافة ADX filter
3. إضافة Williams %R
4. فلتر Z-score
5. فلتر trend strength
"""

import sqlite3
import sys
from pathlib import Path
from datetime import datetime
import itertools

PROJECT_ROOT = Path(__file__).resolve().parent.parent
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))

PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
from analyzers.prediction_optimizer import PredictionOptimizer

SAMPLE_SIZE = 50
SIM_DAYS = 60
MAX_HOLDING = 20
MIN_HISTORY = 100


def calc_adx(highs, lows, closes, period=14):
    """حساب ADX سريع."""
    if len(closes) < period * 2:
        return 25.0
    trs = []
    plus_dms = []
    minus_dms = []
    for i in range(1, len(closes)):
        tr = max(highs[i]-lows[i], abs(highs[i]-closes[i-1]), abs(lows[i]-closes[i-1]))
        up = highs[i] - highs[i-1]
        down = lows[i-1] - lows[i]
        plus_dm = up if up > down and up > 0 else 0
        minus_dm = down if down > up and down > 0 else 0
        trs.append(tr)
        plus_dms.append(plus_dm)
        minus_dms.append(minus_dm)
    # Simple average
    atr = sum(trs[-period:]) / period
    plus_di = (sum(plus_dms[-period:]) / period / atr * 100) if atr > 0 else 25
    minus_di = (sum(minus_dms[-period:]) / period / atr * 100) if atr > 0 else 25
    dx = abs(plus_di - minus_di)
    return dx


def calc_williams_r(highs, lows, closes, period=14):
    """حساب Williams %R."""
    if len(closes) < period:
        return -50.0
    hh = max(highs[-period:])
    ll = min(lows[-period:])
    if hh == ll:
        return -50.0
    return ((hh - closes[-1]) / (hh - ll)) * -100


def simulate(prices_after, entry, target, stop, signal, max_holding=MAX_HOLDING):
    if signal == 'HOLD' or len(prices_after) == 0:
        return ('HOLD', 0, 0)
    for i, price in enumerate(prices_after[:max_holding]):
        if signal == 'BUY':
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
    ret = (last - entry) / entry * 100 if signal == 'BUY' else (entry - last) / entry * 100
    return ('EXPIRED', ret, max_holding)


def run_experiment(min_conviction, use_adx_filter, use_williams_filter, use_trend_strength, label):
    """تشغيل تجربة واحدة."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    stocks = conn.execute("""
        SELECT ticker, COUNT(*) as cnt FROM price_history
        GROUP BY ticker HAVING cnt >= ?
        ORDER BY cnt DESC LIMIT ?
    """, (MIN_HISTORY + SIM_DAYS + MAX_HOLDING, SAMPLE_SIZE)).fetchall()

    engine = PredictionOptimizer()
    engine.min_conviction = min_conviction

    all_trades = []

    for ticker, _ in stocks:
        rows = conn.execute("""
            SELECT date, close_price, high_price, low_price, volume
            FROM price_history WHERE ticker = ? AND close_price > 0
            ORDER BY date ASC
        """, (ticker,)).fetchall()

        if len(rows) < MIN_HISTORY + SIM_DAYS + MAX_HOLDING:
            continue

        prices = [r[1] for r in rows]
        highs = [r[2] or r[1] for r in rows]
        lows = [r[3] or r[1] for r in rows]
        volumes = [r[4] or 0 for r in rows]

        for sim_day in range(SIM_DAYS):
            entry_idx = len(prices) - SIM_DAYS - MAX_HOLDING + sim_day
            if entry_idx < MIN_HISTORY or entry_idx + MAX_HOLDING >= len(prices):
                continue

            hp = prices[:entry_idx + 1]
            hh = highs[:entry_idx + 1]
            hl = lows[:entry_idx + 1]
            hv = volumes[:entry_idx + 1]
            fp = prices[entry_idx + 1:]

            result = engine.analyze(hp, hh, hl, hv)
            if result.signal == 'HOLD':
                continue

            # ADX filter
            if use_adx_filter:
                adx = calc_adx(hh, hl, hp)
                if adx < 20:
                    continue

            # Williams %R filter
            if use_williams_filter:
                wr = calc_williams_r(hh, hl, hp)
                if result.signal == 'BUY' and wr > -50:
                    continue
                if result.signal == 'SELL' and wr < -50:
                    continue

            # Trend strength filter
            if use_trend_strength:
                if len(hp) >= 20:
                    recent_vol = (max(hp[-20:]) - min(hp[-20:])) / (sum(hp[-20:])/20) * 100
                    if recent_vol < 2:  # too flat, skip
                        continue

            outcome, ret, holding = simulate(fp, result.entry, result.target, result.stop, result.signal)
            all_trades.append({
                'signal': result.signal,
                'return': ret,
                'conviction': len(result.conviction_factors),
                'regime': result.regime,
            })

    conn.close()

    if not all_trades:
        return {'label': label, 'trades': 0, 'win_rate': 0, 'avg_return': 0, 'pf': 0}

    total = len(all_trades)
    wins = sum(1 for t in all_trades if t['return'] > 0)
    returns = [t['return'] for t in all_trades]
    avg_ret = sum(returns) / total
    gp = sum(r for r in returns if r > 0)
    gl = abs(sum(r for r in returns if r < 0))
    pf = gp / gl if gl > 0 else 0
    wr = wins / total * 100

    return {
        'label': label,
        'trades': total,
        'win_rate': round(wr, 1),
        'avg_return': round(avg_ret, 2),
        'pf': round(pf, 2),
    }


def main():
    print(f"\n{'#'*70}")
    print(f"# 🧪 Win Rate Experiments — رفع النسبة فوق 61.9%")
    print(f"{'#'*70}")

    experiments = [
        # (min_conviction, adx, williams, trend_strength, label)
        (5, False, False, False, 'Current (conv=5)'),
        (6, False, False, False, 'conv=6'),
        (7, False, False, False, 'conv=7'),
        (5, True, False, False, 'conv=5 + ADX>20'),
        (5, False, True, False, 'conv=5 + Williams'),
        (5, True, True, False, 'conv=5 + ADX + Williams'),
        (6, True, False, False, 'conv=6 + ADX'),
        (6, False, True, False, 'conv=6 + Williams'),
        (6, True, True, False, 'conv=6 + ADX + Williams'),
        (5, True, True, True, 'conv=5 + ADX + Williams + Trend'),
        (6, True, True, True, 'conv=6 + ALL filters'),
    ]

    results = []
    for mc, adx, wil, ts, label in experiments:
        print(f"\n🔄 Running: {label}...")
        r = run_experiment(mc, adx, wil, ts, label)
        results.append(r)
        print(f"   → {r['trades']} trades | WR: {r['win_rate']}% | PF: {r['pf']} | Avg: {r['avg_return']}%")

    # Summary
    print(f"\n{'='*80}")
    print(f"📊 ملخص النتائج")
    print(f"{'='*80}")
    print(f"\n  {'Experiment':<35} {'Trades':>8} {'Win%':>8} {'PF':>6} {'AvgRet':>8}")
    print(f"  {'-'*65}")
    for r in results:
        marker = ' 🎯' if r['win_rate'] >= 65 else (' ✅' if r['win_rate'] >= 60 else '')
        print(f"  {r['label']:<35} {r['trades']:>8} {r['win_rate']:>7.1f}% {r['pf']:>6.2f} {r['avg_return']:>+7.2f}%{marker}")

    # Best
    best = max(results, key=lambda x: x['win_rate'] if x['trades'] >= 10 else 0)
    print(f"\n🏆 الأفضل: {best['label']}")
    print(f"   Win Rate: {best['win_rate']}% | PF: {best['pf']} | Trades: {best['trades']}")


if __name__ == '__main__':
    main()
