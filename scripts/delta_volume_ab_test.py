#!/usr/bin/env python3
"""
Delta Volume A/B Backtest — المرحلة 1
=======================================
يقارن DNA-WINNER مع وبدون delta_volume boost/veto.

الفترة: 2026-02-01 → 2026-08-27 (نفس فترة الـ DNA الأساسي)
Position size: 8% ثابت
Anomaly filter: ON

Run A: DNA-WINNER بدون delta_volume (baseline)
Run B: DNA-WINNER + delta_volume boost/veto

المقارنة: trades, WR, PF, Return, MaxDD, Exp
"""
import os, sys, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from collections import defaultdict
from copy import deepcopy

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

from v40_2_flag_ablation import (
    load_universe, calc_atr, calc_rsi, calc_sma,
    distribution_exit_check, position_size_mult, calc_metrics,
)

# Override load_universe with anomaly filter
_original_load = load_universe
def load_with_anomaly():
    universe = _original_load()
    prices = universe['prices']
    clean = {}
    for ticker, data in prices.items():
        if len(data) < 10:
            clean[ticker] = data
            continue
        is_anom = False
        for i in range(len(data) - 5):
            ps = data[i]['c']
            pe = data[i+5]['c']
            if ps > 0 and abs((pe - ps) / ps) > 0.50:
                is_anom = True
                break
        if not is_anom:
            clean[ticker] = data
    universe['prices'] = clean
    # Add sector
    conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'), timeout=5)
    cur = conn.execute('SELECT ticker, sector FROM stocks')
    sectors = {r[0]: r[1] for r in cur.fetchall()}
    conn.close()
    for ticker, meta in universe['stocks_meta'].items():
        meta['sector'] = sectors.get(ticker) or 'Unknown'
    return universe

# === DELTA VOLUME ===
def get_delta_volume(ticker, universe_prices):
    """جلب آخر delta_volume لسهم من egksco_price_history."""
    # Try to read from DB
    try:
        conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'data_engine.db'), timeout=5)
        row = conn.execute('''
            SELECT delta_pct, pressure, buy_volume, sell_volume
            FROM egksco_price_history
            WHERE symbol = ? AND delta_volume IS NOT NULL
            ORDER BY price_date DESC LIMIT 1
        ''', (ticker,)).fetchone()
        conn.close()
        if row:
            return {'delta_pct': row[0], 'pressure': row[1],
                    'buy_volume': row[2], 'sell_volume': row[3], 'has_data': True}
    except:
        pass
    return {'delta_pct': 0, 'pressure': 'NEUTRAL', 'has_data': False}

def delta_boost(delta_data):
    """حساب boost بناءً على delta_volume."""
    if not delta_data.get('has_data'):
        return 0
    pct = delta_data.get('delta_pct', 0)
    pressure = delta_data.get('pressure', 'NEUTRAL')
    if pressure == 'STRONG_BUY' and pct > 30:
        return 5
    elif pressure == 'BUY' and pct > 10:
        return 3
    elif pressure == 'SELL' and pct < -10:
        return -3
    elif pressure == 'STRONG_SELL' and pct < -30:
        return -100  # VETO
    return 0

# === BACKTEST ENGINE (مطابق للـ DNA-WINNER) ===
START_DATE = '2026-02-01'
END_DATE = '2026-08-27'
SCAN_INTERVAL = 5
MAX_PICKS = 8  # DNA max open
INITIAL_CAPITAL = 100_000
POSITION_SIZE_PCT = 0.08
STOP_LOSS_PCT = 0.07
TAKE_PROFIT_PCT = 0.20
TRAILING_STOP_PCT = 0.10

def run_backtest(use_delta=False):
    """تشغيل backtest. use_delta=True يفعّل delta_volume boost/veto."""
    universe = load_with_anomaly()
    prices = universe['prices']
    stocks_meta = universe['stocks_meta']

    filtered = {}
    for ticker, data in prices.items():
        f = [d for d in data if START_DATE <= d['date'] <= END_DATE]
        if f:
            filtered[ticker] = f

    all_dates = sorted({d['date'] for t in filtered for d in filtered[t]})
    trading_dates = all_dates[::SCAN_INTERVAL]

    trades = []
    open_positions = []
    cash = INITIAL_CAPITAL
    portfolio_history = []
    delta_rejects = 0
    delta_boosts = 0

    for current_date in trading_dates:
        # CLOSE positions
        new_open = []
        for pos in open_positions:
            ticker = pos['ticker']
            if ticker not in filtered:
                continue
            today = next((d for d in filtered[ticker] if d['date'] == current_date), None)
            if not today:
                new_open.append(pos)
                continue
            current_price = today['c'] or today['o']
            if not current_price:
                new_open.append(pos)
                continue
            if current_price > pos['trailing_high']:
                pos['trailing_high'] = current_price
            recent = [d for d in filtered[ticker] if d['date'] <= current_date][-30:]
            rsi = calc_rsi(recent)

            exit_price = None
            exit_reason = None

            # DISTRIBUTION_EXIT
            if True:  # always on in DNA-WINNER
                if distribution_exit_check(today, recent, rsi):
                    exit_price = current_price
                    exit_reason = 'distribution_exit'

            # PARTIAL_EXIT: 40% at 1.5R
            if not exit_price:
                risk = pos['entry_price'] - pos['stop']
                if risk > 0 and not pos.get('partial_done'):
                    target_1_5r = pos['entry_price'] + 1.5 * risk
                    if current_price >= target_1_5r:
                        partial_shares = int(pos['shares'] * 0.4)
                        if partial_shares > 0:
                            cash += partial_shares * current_price
                            pos['shares'] -= partial_shares
                            pos['partial_done'] = True
                            pos['partial_trailing_high'] = current_price
                            pnl = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
                            trades.append({
                                'ticker': ticker, 'entry_date': pos['entry_date'],
                                'exit_date': current_date, 'entry_price': pos['entry_price'],
                                'exit_price': current_price, 'shares': partial_shares,
                                'pnl_pct': pnl, 'exit_reason': 'partial_exit_1.5R',
                            })
                if pos.get('partial_done'):
                    atr = calc_atr(recent)
                    if atr:
                        if current_price > pos.get('partial_trailing_high', current_price):
                            pos['partial_trailing_high'] = current_price
                        if current_price <= pos['partial_trailing_high'] - 1.5 * atr:
                            exit_price = current_price
                            exit_reason = 'partial_trail_1.5ATR'

            # Standard exits
            if not exit_price:
                if today['l'] and today['l'] <= pos['stop']:
                    exit_price = pos['stop']
                    exit_reason = 'stop_loss'
                elif current_price >= pos['target']:
                    exit_price = pos['target']
                    exit_reason = 'take_profit'
                elif current_price <= pos['trailing_high'] * (1 - TRAILING_STOP_PCT):
                    exit_price = current_price
                    exit_reason = 'trailing_stop'

            if exit_price and pos['shares'] > 0:
                cash += pos['shares'] * exit_price
                pnl = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
                trades.append({
                    'ticker': ticker, 'entry_date': pos['entry_date'],
                    'exit_date': current_date, 'entry_price': pos['entry_price'],
                    'exit_price': exit_price, 'shares': pos['shares'],
                    'pnl_pct': pnl, 'exit_reason': exit_reason,
                })
            elif pos['shares'] > 0:
                new_open.append(pos)
        open_positions = [p for p in new_open if p.get('shares', 0) > 0]

        # OPEN new positions
        available = cash * POSITION_SIZE_PCT
        candidates = []
        for ticker in filtered:
            if any(p['ticker'] == ticker for p in open_positions):
                continue
            if ticker not in stocks_meta:
                continue
            today = next((d for d in filtered[ticker] if d['date'] == current_date), None)
            if not today:
                continue
            current_price = today['c'] or today['o']
            if not current_price or current_price <= 0:
                continue
            recent = [d for d in filtered[ticker] if d['date'] <= current_date][-30:]
            if len(recent) < 30:
                continue
            atr = calc_atr(recent)
            if not atr:
                continue
            rsi = calc_rsi(recent)
            ma20 = calc_sma(recent, 20)
            if not ma20 or current_price <= ma20:
                continue

            meta = stocks_meta[ticker]
            score = 50
            if meta.get('pe') and meta['pe'] < 15: score += 15
            elif meta.get('pe') and meta['pe'] < 25: score += 8
            if meta.get('roe') and meta['roe'] > 15: score += 15
            elif meta.get('roe') and meta['roe'] > 10: score += 8
            if rsi and rsi < 30: score += 10
            elif rsi and rsi > 70: score -= 10
            avg_vol = sum(d['v'] for d in recent[-5:]) / 5 if len(recent) >= 5 else 0
            if avg_vol > 0 and today['v'] > avg_vol * 1.5: score += 5

            # === DELTA VOLUME BOOST/VETO ===
            if use_delta:
                delta_data = get_delta_volume(ticker, prices)
                boost = delta_boost(delta_data)
                if boost <= -100:
                    delta_rejects += 1
                    continue  # VETO
                score += boost
                if boost > 0:
                    delta_boosts += 1

            score = max(0, min(100, score))
            candidates.append({
                'ticker': ticker, 'price': current_price, 'score': score,
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS]:
            if len(open_positions) >= MAX_PICKS:
                break
            pos_val = available
            shares = int(pos_val / c['price'])
            if shares <= 0:
                continue
            cost = shares * c['price']
            if cost > cash:
                continue
            cash -= cost
            open_positions.append({
                'ticker': c['ticker'], 'entry_date': current_date,
                'entry_price': c['price'], 'shares': shares,
                'stop': c['price'] * (1 - STOP_LOSS_PCT),
                'target': c['price'] * (1 + TAKE_PROFIT_PCT),
                'trailing_high': c['price'],
            })

        portfolio_history.append({'date': current_date, 'value': cash + sum(
            p['shares'] * (next((d['c'] for d in filtered.get(p['ticker'], []) if d['date'] == current_date), p['entry_price']))
            for p in open_positions)})

    # Close remaining
    last_date = trading_dates[-1] if trading_dates else None
    for pos in open_positions:
        if pos.get('shares', 0) <= 0:
            continue
        ticker = pos['ticker']
        if ticker in filtered:
            last_data = filtered[ticker][-1]
            exit_price = last_data['c'] or pos['entry_price']
            cash += pos['shares'] * exit_price
            pnl = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
            trades.append({
                'ticker': ticker, 'entry_date': pos['entry_date'], 'exit_date': last_date,
                'entry_price': pos['entry_price'], 'exit_price': exit_price, 'shares': pos['shares'],
                'pnl_pct': pnl, 'exit_reason': 'backtest_end',
            })

    metrics = calc_metrics(trades, portfolio_history, cash)
    metrics['delta_rejects'] = delta_rejects
    metrics['delta_boosts'] = delta_boosts
    return trades, metrics, cash


def main():
    print('='*80)
    print('DELTA VOLUME A/B BACKTEST — المرحلة 1')
    print(f'Period: {START_DATE} → {END_DATE}')
    print(f'Position size: {POSITION_SIZE_PCT*100}% | Max open: {MAX_PICKS}')
    print('='*80)

    # Run A: بدون delta_volume
    print('\n--- Run A: DNA-WINNER بدون delta_volume ---')
    trades_a, metrics_a, cash_a = run_backtest(use_delta=False)
    print(f'  Trades: {metrics_a["trades"]} | WR: {metrics_a["win_rate"]}% | PF: {metrics_a["profit_factor"]}')
    print(f'  Return: {metrics_a["total_return"]}% | MaxDD: {metrics_a["max_dd"]}% | Exp: {metrics_a["expectancy"]}%')

    # Run B: مع delta_volume
    print('\n--- Run B: DNA-WINNER + delta_volume boost/veto ---')
    trades_b, metrics_b, cash_b = run_backtest(use_delta=True)
    print(f'  Trades: {metrics_b["trades"]} | WR: {metrics_b["win_rate"]}% | PF: {metrics_b["profit_factor"]}')
    print(f'  Return: {metrics_b["total_return"]}% | MaxDD: {metrics_b["max_dd"]}% | Exp: {metrics_b["expectancy"]}%')
    print(f'  Delta rejects (VETO): {metrics_b["delta_rejects"]}')
    print(f'  Delta boosts: {metrics_b["delta_boosts"]}')

    # Comparison
    print('\n' + '='*80)
    print('COMPARISON TABLE')
    print('='*80)
    print(f'{"Metric":<20} {"Without Delta":>15} {"With Delta":>15} {"Diff":>10}')
    print('-'*65)
    for key in ['trades', 'win_rate', 'profit_factor', 'total_return', 'max_dd', 'expectancy']:
        a = metrics_a[key]
        b = metrics_b[key]
        if isinstance(a, (int, float)) and isinstance(b, (int, float)):
            diff = b - a
            diff_str = f'{diff:+.2f}' if key != 'trades' else f'{diff:+d}'
        else:
            diff_str = 'N/A'
        print(f'{key:<20} {str(a):>15} {str(b):>15} {diff_str:>10}')

    # Verdict
    print('\n' + '='*80)
    print('VERDICT')
    print('='*80)
    pf_a = metrics_a['profit_factor']
    pf_b = metrics_b['profit_factor']
    dd_a = metrics_a['max_dd']
    dd_b = metrics_b['max_dd']

    if isinstance(pf_a, (int, float)) and isinstance(pf_b, (int, float)):
        if pf_b > pf_a and dd_b >= dd_a:
            print('✅ delta_volume IMPROVED results: PF higher + DD better')
        elif pf_b > pf_a:
            print('⚠️  delta_volume improved PF but DD worse')
        elif pf_b < pf_a:
            print('❌ delta_volume HURT results: PF lower')
        else:
            print('⚪ delta_volume had NO effect on PF')
    else:
        print('⚠️  Could not compare (inf PF)')


if __name__ == '__main__':
    main()
