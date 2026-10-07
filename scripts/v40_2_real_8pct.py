#!/usr/bin/env python3
"""
V40.2 REAL backtest — 8% fixed position size.
No pygmy sizing. The DD will show the truth.
"""
import os, sys, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from collections import defaultdict

PROJECT_ROOT = Path('/home/z/my-project')
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

# Import + monkey-patch with anomaly filter
import v40_2_flag_ablation as ablation
original_load = ablation.load_universe

def load_universe_with_anomaly_filter():
    universe = original_load()
    prices = universe['prices']
    clean_prices = {}
    anomalies = 0
    for ticker, data in prices.items():
        if len(data) < 10:
            clean_prices[ticker] = data
            continue
        is_anomalous = False
        for i in range(len(data) - 5):
            p_start = data[i]['c']
            p_end = data[i+5]['c']
            if p_start > 0:
                change = abs((p_end - p_start) / p_start)
                if change > 0.50:
                    is_anomalous = True
                    anomalies += 1
                    break
        if not is_anomalous:
            clean_prices[ticker] = data
    universe['prices'] = clean_prices
    print(f'[ANOMALY FILTER] Rejected {anomalies} tickers with >50% moves in 5 days')
    return universe

ablation.load_universe = load_universe_with_anomaly_filter
import v40_2_full_pipeline as pipeline
pipeline.load_universe = load_universe_with_anomaly_filter

from v40_2_full_pipeline import (
    Config, OUTPUT_DIR, START_DATE, END_DATE, INITIAL_CAPITAL,
    calc_atr, calc_rsi, calc_sma, distribution_exit_check,
    get_market_daily_change, calc_rs, calc_fund_score
)
from v40_2_flag_ablation import calc_metrics

# Patch: add sector to stocks_meta
_original_load = load_universe_with_anomaly_filter
def load_with_sector():
    universe = _original_load()
    import sqlite3
    conn = sqlite3.connect(str(PROJECT_ROOT / 'db' / 'stocks.db'), timeout=5)
    cur = conn.execute('SELECT ticker, sector FROM stocks')
    sectors = {r[0]: r[1] for r in cur.fetchall()}
    conn.close()
    for ticker, meta in universe['stocks_meta'].items():
        meta['sector'] = sectors.get(ticker) or 'Unknown'
    return universe

# Override all references
ablation.load_universe = load_with_sector
pipeline.load_universe = load_with_sector

# Override position size: 8% fixed
POSITION_SIZE_PCT = 0.08  # FIXED 8%
STOP_LOSS_PCT = 0.07
TAKE_PROFIT_PCT = 0.20
TRAILING_STOP_PCT = 0.10
SCAN_INTERVAL = 5
MAX_PICKS_PER_DAY = 5
MIN_HISTORY_DAYS = 30


def run_real_backtest(config, start_date=None, end_date=None):
    """Backtest with 8% fixed position size — no pygmy sizing."""
    sd = start_date or START_DATE
    ed = end_date or END_DATE
    universe = load_with_sector()
    prices = universe['prices']
    stocks_meta = universe['stocks_meta']
    notebooks = universe['notebooks']

    filtered_prices = {}
    for ticker, data in prices.items():
        filtered = [d for d in data if sd <= d['date'] <= ed]
        if filtered:
            filtered_prices[ticker] = filtered

    all_dates = sorted({d['date'] for t in filtered_prices for d in filtered_prices[t]})
    trading_dates = all_dates[::SCAN_INTERVAL]

    trades = []
    open_positions = []
    cash = INITIAL_CAPITAL
    portfolio_history = []
    buy_on_down_days = 0
    sector_pnl = defaultdict(lambda: {'count': 0, 'pnl_sum': 0})

    for current_date in trading_dates:
        # === CLOSE POSITIONS ===
        new_open = []
        for pos in open_positions:
            ticker = pos['ticker']
            if ticker not in filtered_prices:
                continue
            today_data = next((d for d in filtered_prices[ticker] if d['date'] == current_date), None)
            if not today_data:
                new_open.append(pos)
                continue
            current_price = today_data['c'] or today_data['o']
            if not current_price:
                new_open.append(pos)
                continue
            if current_price > pos['trailing_high']:
                pos['trailing_high'] = current_price
            recent = [d for d in filtered_prices[ticker] if d['date'] <= current_date][-30:]
            rsi = calc_rsi(recent)

            exit_price = None
            exit_reason = None
            exit_shares = pos['shares']

            # DISTRIBUTION_EXIT
            if config.distribution_exit:
                if distribution_exit_check(today_data, recent, rsi):
                    exit_price = current_price
                    exit_reason = 'distribution_exit'

            # PARTIAL_EXIT: sell 40% at 1.5R — 60% stays at SAME risk (no further shrinking)
            if config.partial_exit and not exit_price:
                risk = pos['entry_price'] - pos['stop']
                if risk > 0 and not pos.get('partial_done'):
                    target_1_5r = pos['entry_price'] + 1.5 * risk
                    if current_price >= target_1_5r:
                        partial_shares = int(pos['shares'] * 0.4)
                        if partial_shares > 0:
                            proceeds = partial_shares * current_price
                            cash += proceeds
                            pos['shares'] -= partial_shares
                            pos['partial_done'] = True
                            pos['partial_trailing_high'] = current_price
                            pnl_pct = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
                            trades.append({
                                'ticker': ticker, 'entry_date': pos['entry_date'],
                                'exit_date': current_date, 'entry_price': pos['entry_price'],
                                'exit_price': current_price, 'shares': partial_shares,
                                'pnl_pct': pnl_pct, 'exit_reason': 'partial_exit_1.5R',
                                'position_value_egp': partial_shares * pos['entry_price'],
                                'sector': pos.get('sector'),
                            })
                            sector_pnl[pos.get('sector', 'Unknown')]['count'] += 1
                            sector_pnl[pos.get('sector', 'Unknown')]['pnl_sum'] += pnl_pct
                # Trail remaining at 1.5×ATR
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
                if today_data['l'] and today_data['l'] <= pos['stop']:
                    exit_price = pos['stop']
                    exit_reason = 'stop_loss'
                elif current_price >= pos['target']:
                    exit_price = pos['target']
                    exit_reason = 'take_profit'
                elif current_price <= pos['trailing_high'] * (1 - TRAILING_STOP_PCT):
                    exit_price = current_price
                    exit_reason = 'trailing_stop'

            if exit_price and pos['shares'] > 0:
                proceeds = pos['shares'] * exit_price
                cash += proceeds
                pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
                trades.append({
                    'ticker': ticker, 'entry_date': pos['entry_date'],
                    'exit_date': current_date, 'entry_price': pos['entry_price'],
                    'exit_price': exit_price, 'shares': pos['shares'],
                    'pnl_pct': pnl_pct, 'exit_reason': exit_reason,
                    'position_value_egp': pos['shares'] * pos['entry_price'],
                    'sector': pos.get('sector'),
                })
                sector_pnl[pos.get('sector', 'Unknown')]['count'] += 1
                sector_pnl[pos.get('sector', 'Unknown')]['pnl_sum'] += pnl_pct
            elif pos['shares'] > 0:
                new_open.append(pos)
        open_positions = [p for p in new_open if p.get('shares', 0) > 0]

        # === OPEN NEW POSITIONS ===
        # EGX30 down > 0.4% → skip BUY (but still track)
        market_change = get_market_daily_change(current_date)
        market_down = market_change < -0.4
        if config.egx30_down_hold and market_down:
            continue  # skip BUY

        available_capital = cash * POSITION_SIZE_PCT
        candidates = []
        for ticker in filtered_prices:
            if any(p['ticker'] == ticker for p in open_positions):
                continue
            if ticker not in stocks_meta:
                continue
            today_data = next((d for d in filtered_prices[ticker] if d['date'] == current_date), None)
            if not today_data:
                continue
            current_price = today_data['c'] or today_data['o']
            if not current_price or current_price <= 0:
                continue
            recent = [d for d in filtered_prices[ticker] if d['date'] <= current_date][-30:]
            if len(recent) < MIN_HISTORY_DAYS:
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
            if meta['pe'] and meta['pe'] < 15: score += 15
            elif meta['pe'] and meta['pe'] < 25: score += 8
            if meta['roe'] and meta['roe'] > 15: score += 15
            elif meta['roe'] and meta['roe'] > 10: score += 8
            if rsi and rsi < 30: score += 10
            elif rsi and rsi > 70: score -= 10
            avg_vol = sum(d['v'] for d in recent[-5:]) / 5 if len(recent) >= 5 else 0
            if avg_vol > 0 and today_data['v'] > avg_vol * 1.5: score += 5
            score = max(0, min(100, score))
            stop_pct = STOP_LOSS_PCT * 100
            target_pct = TAKE_PROFIT_PCT * 100
            candidates.append({
                'ticker': ticker, 'price': current_price, 'score': score,
                'stop_pct': stop_pct, 'target_pct': target_pct, 'meta': meta,
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS_PER_DAY]:
            # FIXED 8% — no volatility scaling, no portfolio heat
            position_value = available_capital  # 8% of cash
            if position_value < 1000: continue
            shares = int(position_value / c['price'])
            if shares <= 0: continue
            cost = shares * c['price']
            if cost > cash: continue
            cash -= cost
            open_positions.append({
                'ticker': c['ticker'], 'entry_date': current_date,
                'entry_price': c['price'], 'shares': shares,
                'stop': c['price'] * (1 - c['stop_pct'] / 100),
                'target': c['price'] * (1 + c['target_pct'] / 100),
                'trailing_high': c['price'],
                'sector': c['meta'].get('sector'),
            })

        portfolio_value = cash + sum(
            p['shares'] * (next((d['c'] for d in filtered_prices.get(p['ticker'], []) if d['date'] == current_date), p['entry_price']))
            for p in open_positions)
        portfolio_history.append({'date': current_date, 'value': portfolio_value})

    # Close remaining
    last_date = trading_dates[-1] if trading_dates else None
    for pos in open_positions:
        if pos.get('shares', 0) <= 0: continue
        ticker = pos['ticker']
        if ticker in filtered_prices:
            last_data = filtered_prices[ticker][-1]
            exit_price = last_data['c'] or pos['entry_price']
            proceeds = pos['shares'] * exit_price
            cash += proceeds
            pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
            trades.append({
                'ticker': ticker, 'entry_date': pos['entry_date'], 'exit_date': last_date,
                'entry_price': pos['entry_price'], 'exit_price': exit_price, 'shares': pos['shares'],
                'pnl_pct': pnl_pct, 'exit_reason': 'backtest_end',
                'position_value_egp': pos['shares'] * pos['entry_price'],
                'sector': pos.get('sector'),
            })
            sector_pnl[pos.get('sector', 'Unknown')]['count'] += 1
            sector_pnl[pos.get('sector', 'Unknown')]['pnl_sum'] += pnl_pct

    metrics = calc_metrics(trades, portfolio_history, cash)
    return trades, metrics, portfolio_history, sector_pnl


# === RUN ===
print('='*80)
print('V40.2 REAL BACKTEST — 8% FIXED POSITION SIZE')
print('DNA: distribution_exit + egx30_down_hold + partial_exit')
print('Anomaly filter: ON (>50% in 5 days = reject)')
print('='*80)

c = Config('REAL_8PCT')
c.distribution_exit = True
c.egx30_down_hold = True
c.partial_exit = True

trades, metrics, portfolio_history, sector_pnl = run_real_backtest(c)

print(f'\n{"="*60}')
print('METRICS — 8% FIXED SIZE')
print(f'{"="*60}')
print(f'Trades:         {metrics["trades"]}')
print(f'WR:             {metrics["win_rate"]}%')
print(f'PF:             {metrics["profit_factor"]}')
print(f'Total Return:   {metrics["total_return"]}%')
print(f'MaxDD:          {metrics["max_dd"]}%  ← THE REAL NUMBER')
print(f'Expectancy:     {metrics["expectancy"]}%')
print(f'Final Capital:  {metrics["final_capital"]:.0f} EGP')

# === Position sizing check ===
print(f'\n{"="*60}')
print('POSITION SIZING CHECK')
print(f'{"="*60}')
pos_values = [t['shares'] * t['entry_price'] for t in trades]
if pos_values:
    avg = sum(pos_values) / len(pos_values)
    print(f'Avg position: {avg:.0f} EGP ({avg/INITIAL_CAPITAL*100:.1f}% of capital)')
    print(f'Max position: {max(pos_values):.0f} EGP ({max(pos_values)/INITIAL_CAPITAL*100:.1f}%)')
    print(f'Min position: {min(pos_values):.0f} EGP ({min(pos_values)/INITIAL_CAPITAL*100:.1f}%)')

# === Holding days ===
print(f'\n{"="*60}')
print('HOLDING DAYS')
print(f'{"="*60}')
holding_days = []
for t in trades:
    try:
        entry = datetime.strptime(t['entry_date'], '%Y-%m-%d')
        exit_d = datetime.strptime(t['exit_date'], '%Y-%m-%d')
        holding_days.append((exit_d - entry).days)
    except: pass
if holding_days:
    print(f'Avg: {sum(holding_days)/len(holding_days):.1f} | Median: {sorted(holding_days)[len(holding_days)//2]} | Min: {min(holding_days)} | Max: {max(holding_days)}')

# === Top 5 losers ===
print(f'\n{"="*60}')
print('TOP 5 LOSERS (detail)')
print(f'{"="*60}')
losers = sorted(trades, key=lambda x: x['pnl_pct'])[:5]
for t in losers:
    print(f"  {t['ticker']:6s} entry={t['entry_price']:8.2f} exit={t['exit_price']:8.2f} "
          f"shares={t['shares']:>5} pnl={t['pnl_pct']:+7.2f}% reason={t['exit_reason']} "
          f"pos_val={t['shares']*t['entry_price']:.0f}")

# === Sector concentration ===
print(f'\n{"="*60}')
print('SECTOR CONCENTRATION')
print(f'{"="*60}')
total_pnl = sum(s['pnl_sum'] for s in sector_pnl.values())
sorted_sectors = sorted(sector_pnl.items(), key=lambda x: x[1]['pnl_sum'], reverse=True)
print(f'{"Sector":<30} {"Trades":>7} {"Total PnL%":>12} {"Share":>8}')
print('-'*60)
for sector, stats in sorted_sectors[:10]:
    share = stats['pnl_sum'] / total_pnl * 100 if total_pnl != 0 else 0
    print(f'{sector or "Unknown":<30} {stats["count"]:>7} {stats["pnl_sum"]:>+12.2f} {share:>7.1f}%')

# === Trades on market-down days ===
print(f'\n{"="*60}')
print('BUY ON MARKET-DOWN DAYS (should be 0 if egx30_down_hold works)')
print(f'{"="*60}')
universe = load_with_sector()
prices = universe['prices']
all_dates = sorted({d['date'] for t in prices for d in prices[t]})
trading_dates = all_dates[::SCAN_INTERVAL]
market_down_days = 0
buy_on_down = 0
for d in trading_dates:
    change = get_market_daily_change(d)
    if change < -0.4:
        market_down_days += 1
        # Check if any trade opened on this day
        for t in trades:
            if t['entry_date'] == d:
                buy_on_down += 1
                break
print(f'Market-down days in period: {market_down_days}')
print(f'Trades opened on market-down days: {buy_on_down}')

# === Equity curve sample ===
print(f'\n{"="*60}')
print('EQUITY CURVE (sampled ~15 points)')
print(f'{"="*60}')
print(f'{"Date":<12} {"Equity":>12} {"DD from peak":>14}')
print('-'*40)
peak = INITIAL_CAPITAL
samples = portfolio_history[::max(1, len(portfolio_history)//15)]
for ph in samples:
    if ph['value'] > peak:
        peak = ph['value']
    dd = (ph['value'] - peak) / peak * 100 if peak > 0 else 0
    print(f'{ph["date"]:<12} {ph["value"]:>12,.0f} {dd:>+14.2f}%')

# === VERDICT ===
print(f'\n{"="*60}')
print('VERDICT')
print(f'{"="*60}')
print(f'MaxDD: {metrics["max_dd"]}%')
if metrics['max_dd'] < -25:
    print('❌ MaxDD > 25% → risk management ضعيف')
elif metrics['max_dd'] < -18:
    print('⚠️ MaxDD 18-25% → محتاج تحسين')
else:
    print('✅ MaxDD < 18% → مقبول')

pf = metrics['profit_factor']
if isinstance(pf, (int, float)):
    if pf >= 2.5:
        print(f'✅ PF {pf} ≥ 2.5 → قوي')
    elif pf >= 1.8:
        print(f'⚠️ PF {pf} 1.8-2.5 → مقبول')
    else:
        print(f'❌ PF {pf} < 1.8 → ضعيف')

# === Save ===
csv_path = OUTPUT_DIR / 'REAL_8pct_trades.csv'
with open(csv_path, 'w') as f:
    f.write('ticker,entry_date,exit_date,entry_price,exit_price,shares,pnl_pct,exit_reason,holding_days,position_value_egp,sector\n')
    for t in sorted(trades, key=lambda x: x['entry_date']):
        try:
            entry = datetime.strptime(t['entry_date'], '%Y-%m-%d')
            exit_d = datetime.strptime(t['exit_date'], '%Y-%m-%d')
            days = (exit_d - entry).days
        except: days = ''
        f.write(f"{t['ticker']},{t['entry_date']},{t['exit_date']},{t['entry_price']:.2f},{t['exit_price']:.2f},{t['shares']},{t['pnl_pct']:.2f},{t['exit_reason']},{days},{t.get('position_value_egp',0):.0f},{t.get('sector','')}\n")
print(f'\n📄 Trades: {csv_path}')

# Save metrics + sector
with open(OUTPUT_DIR / 'REAL_8pct_summary.json', 'w') as f:
    json.dump({
        'metrics': metrics,
        'sector_concentration': dict(sector_pnl),
        'market_down_days': market_down_days,
        'buy_on_down_days': buy_on_down,
    }, f, indent=2, default=str)
print(f'📄 Summary: {OUTPUT_DIR}/REAL_8pct_summary.json')
