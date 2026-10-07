#!/usr/bin/env python3
"""
V40.2 — Sector limit + max exposure analysis + OOS 2025
1. Add sector limit: Finance ≤25%, others ≤20%
2. Track: max open positions, avg open, sector violations
3. Test DNA on 2025 (Jan-Dec) and last 60 days
"""
import os, sys, json, sqlite3, math
from pathlib import Path
from datetime import datetime
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

import v40_2_flag_ablation as ablation

def load_with_filters():
    """Load universe from scratch with ONLY anomaly filter (no price sanity check).
    The price sanity check (ratio vs current_price) is look-ahead bias — rejected."""
    import json as _json
    STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
    DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
    NOTEBOOKS_DIR = PROJECT_ROOT / 'notebooks' / 'EGX'

    # 1. EGX tickers from stocks.db
    conn_s = sqlite3.connect(STOCKS_DB, timeout=10)
    cur = conn_s.execute('''
        SELECT ticker, name, current_price, pe_ratio, pb_ratio, roe, roa,
               dividend_yield, market_cap, beta, ma_50, ma_200, rsi,
               support, resistance, high_52w, low_52w, sector
        FROM stocks
        WHERE market IN ('EGX', 'مصر') AND is_active = 1
        AND current_price IS NOT NULL AND current_price > 0
    ''')
    stocks_meta = {}
    egx_tickers = set()
    for row in cur.fetchall():
        (ticker, name, price, pe, pb, roe, roa, div_yield, mc, beta,
         ma50, ma200, rsi, support, resistance, high52w, low52w, sector) = row
        stocks_meta[ticker] = {
            'name': name, 'price': float(price) if price else 0,
            'pe': float(pe) if pe else None,
            'pb': float(pb) if pb else None,
            'roe': float(roe) if roe else None,
            'roa': float(roa) if roa else None,
            'dividend_yield': float(div_yield) if div_yield else None,
            'market_cap': float(mc) if mc else None,
            'beta': float(beta) if beta else None,
            'ma_50': float(ma50) if ma50 else None,
            'ma_200': float(ma200) if ma200 else None,
            'rsi': float(rsi) if rsi else None,
            'high_52w': float(high52w) if high52w else None,
            'low_52w': float(low52w) if low52w else None,
            'sector': sector or 'Unknown',
        }
        egx_tickers.add(ticker)
    conn_s.close()
    print(f'[LOAD] EGX tickers: {len(egx_tickers)}')

    # 2. Screener tickers
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=10)
    cur = conn.execute('''
        SELECT DISTINCT symbol FROM screener_lists
        WHERE category IN ('most_active', 'unusual_volume', 'top_gainers')
        AND market = 'مصر'
    ''')
    screener_tickers = sorted({r[0] for r in cur.fetchall()} & egx_tickers)
    print(f'[LOAD] Screener ∩ EGX: {len(screener_tickers)}')

    # 3. Price history — NO sanity check, ONLY anomaly filter
    placeholders = ','.join('?' * len(screener_tickers))
    cur = conn.execute(f'''
        SELECT symbol, price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol IN ({placeholders})
        ORDER BY symbol, price_date ASC
    ''', screener_tickers)
    from collections import defaultdict
    prices = defaultdict(list)
    rejected_anom = 0
    # First, load all data
    all_data = defaultdict(list)
    for row in cur.fetchall():
        symbol, date, o, h, l, c, v = row
        if not c or c <= 0:
            continue
        all_data[symbol].append({'date': date, 'o': o or 0, 'h': h or 0, 'l': l or 0, 'c': c, 'v': v or 0})
    # Then apply anomaly filter per ticker
    for ticker, data in all_data.items():
        if len(data) < 10:
            prices[ticker] = data
            continue
        clean_data = []
        is_anom_ticker = False
        for i in range(len(data)):
            # Check if this point is part of a >50% in 5 days move
            is_anom_point = False
            if i >= 5:
                ps = data[i-5]['c']
                pe = data[i]['c']
                if ps > 0 and abs((pe - ps) / ps) > 0.50:
                    is_anom_ticker = True
                    break
            clean_data.append(data[i])
        if not is_anom_ticker:
            prices[ticker] = data
        else:
            rejected_anom += 1
    conn.close()
    print(f'[LOAD] Anomalies rejected: {rejected_anom} tickers')
    print(f'[LOAD] Tickers with prices: {len(prices)}')

    # 4. Notebooks
    notebooks = {}
    if NOTEBOOKS_DIR.exists():
        for nb_file in NOTEBOOKS_DIR.glob('*.json'):
            ticker = nb_file.stem
            if ticker not in egx_tickers:
                continue
            try:
                with open(nb_file) as f:
                    nb = _json.load(f)
                notebooks[ticker] = nb.get('machine_summary', {})
            except Exception:
                pass

    universe = {
        'screener_tickers': screener_tickers,
        'stocks_meta': stocks_meta,
        'prices': dict(prices),
        'notebooks': notebooks,
    }
    return universe

ablation.load_universe = load_with_filters
import v40_2_full_pipeline as pipeline
pipeline.load_universe = load_with_filters

from v40_2_full_pipeline import (
    Config, OUTPUT_DIR, START_DATE, END_DATE, INITIAL_CAPITAL,
    calc_atr, calc_rsi, calc_sma, distribution_exit_check,
    get_market_daily_change
)
from v40_2_flag_ablation import calc_metrics

POSITION_SIZE_PCT = 0.08
STOP_LOSS_PCT = 0.07
TAKE_PROFIT_PCT = 0.20
TRAILING_STOP_PCT = 0.10
SCAN_INTERVAL = 5
MAX_PICKS_PER_DAY = 5
MIN_HISTORY_DAYS = 30

# Sector limits (as % of capital)
SECTOR_LIMIT = {
    'Finance': 0.25,        # 25% max
    'Financial Services': 0.25,
    'Banks': 0.25,
    'Real Estate': 0.20,
    'Process Industries': 0.20,
    'Producer Manufacturing': 0.20,
}
DEFAULT_SECTOR_LIMIT = 0.20  # 20% for any other sector


def run_with_sector_limit(config, start_date=None, end_date=None):
    """Backtest with sector exposure limits."""
    sd = start_date or START_DATE
    ed = end_date or END_DATE
    universe = load_with_filters()
    prices = universe['prices']
    stocks_meta = universe['stocks_meta']

    filtered = {}
    for ticker, data in prices.items():
        f = [d for d in data if sd <= d['date'] <= ed]
        if f:
            filtered[ticker] = f

    all_dates = sorted({d['date'] for t in filtered for d in filtered[t]})
    trading_dates = all_dates[::SCAN_INTERVAL]

    trades = []
    open_positions = []
    cash = INITIAL_CAPITAL
    portfolio_history = []

    # Exposure tracking
    max_open_positions = 0
    open_positions_count_sum = 0
    open_positions_samples = 0
    sector_exposure_history = []  # list of (date, {sector: exposure_pct})
    sector_violations = 0
    sector_violation_details = []

    # Per-sector rejected count
    sector_rejected = defaultdict(int)

    for current_date in trading_dates:
        # === CLOSE ===
        new_open = []
        for pos in open_positions:
            ticker = pos['ticker']
            if ticker not in filtered:
                continue
            today_data = next((d for d in filtered[ticker] if d['date'] == current_date), None)
            if not today_data:
                new_open.append(pos)
                continue
            current_price = today_data['c'] or today_data['o']
            if not current_price:
                new_open.append(pos)
                continue
            if current_price > pos['trailing_high']:
                pos['trailing_high'] = current_price
            recent = [d for d in filtered[ticker] if d['date'] <= current_date][-30:]
            rsi = calc_rsi(recent)
            exit_price = None
            exit_reason = None

            if config.distribution_exit:
                if distribution_exit_check(today_data, recent, rsi):
                    exit_price = current_price
                    exit_reason = 'distribution_exit'

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
                                'sector': pos.get('sector'),
                            })
                if pos.get('partial_done'):
                    atr = calc_atr(recent)
                    if atr:
                        if current_price > pos.get('partial_trailing_high', current_price):
                            pos['partial_trailing_high'] = current_price
                        if current_price <= pos['partial_trailing_high'] - 1.5 * atr:
                            exit_price = current_price
                            exit_reason = 'partial_trail_1.5ATR'

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
                    'sector': pos.get('sector'),
                })
            elif pos['shares'] > 0:
                new_open.append(pos)
        open_positions = [p for p in new_open if p.get('shares', 0) > 0]

        # Track exposure
        open_positions_count_sum += len(open_positions)
        open_positions_samples += 1
        if len(open_positions) > max_open_positions:
            max_open_positions = len(open_positions)

        # Current sector exposure
        sector_exposure = defaultdict(float)
        total_exposure = 0
        for pos in open_positions:
            ticker = pos['ticker']
            today_data = next((d for d in filtered.get(ticker, []) if d['date'] == current_date), None)
            mv = (today_data['c'] if today_data and today_data['c'] else pos['entry_price']) * pos['shares']
            sector = pos.get('sector', 'Unknown')
            sector_exposure[sector] += mv
            total_exposure += mv
        # Convert to % of capital
        cap = cash + total_exposure
        sector_pct = {s: (v / cap * 100 if cap > 0 else 0) for s, v in sector_exposure.items()}
        sector_exposure_history.append({'date': current_date, 'sectors': sector_pct, 'open_count': len(open_positions)})

        # Check violations
        for s, pct in sector_pct.items():
            limit = SECTOR_LIMIT.get(s, DEFAULT_SECTOR_LIMIT) * 100
            if pct > limit:
                sector_violations += 1
                sector_violation_details.append({'date': current_date, 'sector': s, 'pct': pct, 'limit': limit})

        # === OPEN NEW ===
        if config.egx30_down_hold:
            market_change = get_market_daily_change(current_date)
            if market_change < -0.4:
                portfolio_value = cash + total_exposure
                portfolio_history.append({'date': current_date, 'value': portfolio_value})
                continue

        available_capital = cash * POSITION_SIZE_PCT
        candidates = []
        for ticker in filtered:
            if any(p['ticker'] == ticker for p in open_positions):
                continue
            if ticker not in stocks_meta:
                continue
            today_data = next((d for d in filtered[ticker] if d['date'] == current_date), None)
            if not today_data:
                continue
            current_price = today_data['c'] or today_data['o']
            if not current_price or current_price <= 0:
                continue
            recent = [d for d in filtered[ticker] if d['date'] <= current_date][-30:]
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

            sector = meta.get('sector', 'Unknown')
            # Check sector limit
            current_sector_exposure_pct = sector_pct.get(sector, 0)
            sector_limit_pct = SECTOR_LIMIT.get(sector, DEFAULT_SECTOR_LIMIT) * 100
            if current_sector_exposure_pct >= sector_limit_pct:
                sector_rejected[sector] += 1
                continue

            candidates.append({
                'ticker': ticker, 'price': current_price, 'score': score,
                'stop_pct': STOP_LOSS_PCT * 100, 'target_pct': TAKE_PROFIT_PCT * 100,
                'meta': meta, 'sector': sector,
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS_PER_DAY]:
            position_value = available_capital
            if position_value < 1000: continue
            shares = int(position_value / c['price'])
            if shares <= 0: continue
            cost = shares * c['price']
            if cost > cash: continue
            # Final sector check after we know the cost
            sector = c['sector']
            new_sector_exposure = sector_pct.get(sector, 0) + (cost / (cash + total_exposure) * 100 if (cash + total_exposure) > 0 else 0)
            sector_limit_pct = SECTOR_LIMIT.get(sector, DEFAULT_SECTOR_LIMIT) * 100
            if new_sector_exposure > sector_limit_pct:
                sector_rejected[sector] += 1
                continue
            cash -= cost
            open_positions.append({
                'ticker': c['ticker'], 'entry_date': current_date,
                'entry_price': c['price'], 'shares': shares,
                'stop': c['price'] * (1 - c['stop_pct'] / 100),
                'target': c['price'] * (1 + c['target_pct'] / 100),
                'trailing_high': c['price'],
                'sector': c['sector'],
            })

        portfolio_value = cash + sum(
            p['shares'] * (next((d['c'] for d in filtered.get(p['ticker'], []) if d['date'] == current_date), p['entry_price']))
            for p in open_positions)
        portfolio_history.append({'date': current_date, 'value': portfolio_value})

    # Close remaining
    last_date = trading_dates[-1] if trading_dates else None
    for pos in open_positions:
        if pos.get('shares', 0) <= 0: continue
        ticker = pos['ticker']
        if ticker in filtered:
            last_data = filtered[ticker][-1]
            exit_price = last_data['c'] or pos['entry_price']
            proceeds = pos['shares'] * exit_price
            cash += proceeds
            pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
            trades.append({
                'ticker': ticker, 'entry_date': pos['entry_date'], 'exit_date': last_date,
                'entry_price': pos['entry_price'], 'exit_price': exit_price, 'shares': pos['shares'],
                'pnl_pct': pnl_pct, 'exit_reason': 'backtest_end',
                'sector': pos.get('sector'),
            })

    metrics = calc_metrics(trades, portfolio_history, cash)
    exposure_stats = {
        'max_open_positions': max_open_positions,
        'avg_open_positions': round(open_positions_count_sum / open_positions_samples, 2) if open_positions_samples > 0 else 0,
        'sector_violations': sector_violations,
        'sector_violation_details': sector_violation_details[:20],
        'sector_rejected': dict(sector_rejected),
    }
    return trades, metrics, portfolio_history, exposure_stats


# === RUN ALL TESTS ===
print('='*80)
print('V40.2 — SECTOR LIMIT + EXPOSURE ANALYSIS + OOS')
print('='*80)

c = Config('SECTOR_LIMITED')
c.distribution_exit = True
c.egx30_down_hold = True
c.partial_exit = True

# === Test 1: Main period (Feb-Aug 2026) with sector limit ===
print('\n--- TEST 1: Main period 2026-02-01 → 2026-08-27 (WITH sector limit) ---')
trades, metrics, _, exposure = run_with_sector_limit(c, START_DATE, END_DATE)
print(f'Trades: {metrics["trades"]} | WR: {metrics["win_rate"]}% | PF: {metrics["profit_factor"]} | Return: {metrics["total_return"]}% | MaxDD: {metrics["max_dd"]}% | Exp: {metrics["expectancy"]}%')
print(f'Max open positions: {exposure["max_open_positions"]}')
print(f'Avg open positions: {exposure["avg_open_positions"]}')
print(f'Sector violations (over limit): {exposure["sector_violations"]}')
print(f'Sector rejected (entry blocked): {exposure["sector_rejected"]}')

# Sector concentration
sector_pnl = defaultdict(lambda: {'count': 0, 'pnl_sum': 0})
for t in trades:
    sector_pnl[t.get('sector', 'Unknown')]['count'] += 1
    sector_pnl[t.get('sector', 'Unknown')]['pnl_sum'] += t['pnl_pct']
total_pnl = sum(s['pnl_sum'] for s in sector_pnl.values())
print(f'\nSector concentration (with limit):')
print(f'{"Sector":<30} {"Trades":>7} {"PnL%":>10} {"Share":>8}')
for s, st in sorted(sector_pnl.items(), key=lambda x: x[1]['pnl_sum'], reverse=True)[:8]:
    share = st['pnl_sum'] / total_pnl * 100 if total_pnl != 0 else 0
    print(f'{(s or "Unknown"):<30} {st["count"]:>7} {st["pnl_sum"]:>+10.2f} {share:>7.1f}%')

# === Test 2: OOS 2025 (Jan-Dec) ===
print('\n--- TEST 2: OOS 2025-01-09 → 2025-12-31 ---')
trades25, metrics25, _, exp25 = run_with_sector_limit(c, '2025-01-09', '2025-12-31')
print(f'Trades: {metrics25["trades"]} | WR: {metrics25["win_rate"]}% | PF: {metrics25["profit_factor"]} | Return: {metrics25["total_return"]}% | MaxDD: {metrics25["max_dd"]}% | Exp: {metrics25["expectancy"]}%')
print(f'Max open: {exp25["max_open_positions"]} | Avg: {exp25["avg_open_positions"]} | Violations: {exp25["sector_violations"]}')

# === Test 3: Last 60 days ===
print('\n--- TEST 3: Last 60 days live ---')
universe = load_with_filters()
all_dates = sorted({d['date'] for t in universe['prices'] for d in universe['prices'][t]})
if len(all_dates) >= 60:
    last60_start = all_dates[-60]
    last60_end = all_dates[-1]
    print(f'Period: {last60_start} → {last60_end}')
    trades60, metrics60, _, exp60 = run_with_sector_limit(c, last60_start, last60_end)
    print(f'Trades: {metrics60["trades"]} | WR: {metrics60["win_rate"]}% | PF: {metrics60["profit_factor"]} | Return: {metrics60["total_return"]}% | MaxDD: {metrics60["max_dd"]}% | Exp: {metrics60["expectancy"]}%')
    print(f'Max open: {exp60["max_open_positions"]} | Avg: {exp60["avg_open_positions"]} | Violations: {exp60["sector_violations"]}')

# === SUMMARY ===
print('\n' + '='*80)
print('FINAL SUMMARY — 3 periods')
print('='*80)
print(f'{"Period":<28} {"Trades":>7} {"WR%":>7} {"PF":>6} {"Return%":>9} {"MaxDD%":>8} {"Exp%":>7} {"MaxOpen":>8} {"AvgOpen":>8}')
print('-'*90)
print(f'{"2026-02 to 2026-08 (main)":<28} {metrics["trades"]:>7} {metrics["win_rate"]:>7.2f} {metrics["profit_factor"]:>6} {metrics["total_return"]:>+9.2f} {metrics["max_dd"]:>+8.2f} {metrics["expectancy"]:>+7.2f} {exposure["max_open_positions"]:>8} {exposure["avg_open_positions"]:>8.2f}')
print(f'{"2025-01 to 2025-12 (OOS)":<28} {metrics25["trades"]:>7} {metrics25["win_rate"]:>7.2f} {metrics25["profit_factor"]:>6} {metrics25["total_return"]:>+9.2f} {metrics25["max_dd"]:>+8.2f} {metrics25["expectancy"]:>+7.2f} {exp25["max_open_positions"]:>8} {exp25["avg_open_positions"]:>8.2f}')
if len(all_dates) >= 60:
    print(f'{"Last 60 days (live)":<28} {metrics60["trades"]:>7} {metrics60["win_rate"]:>7.2f} {metrics60["profit_factor"]:>6} {metrics60["total_return"]:>+9.2f} {metrics60["max_dd"]:>+8.2f} {metrics60["expectancy"]:>+7.2f} {exp60["max_open_positions"]:>8} {exp60["avg_open_positions"]:>8.2f}')

# Save
with open(OUTPUT_DIR / 'sector_limit_results.json', 'w') as f:
    json.dump({
        'main_period': {'metrics': metrics, 'exposure': exposure},
        'oos_2025': {'metrics': metrics25, 'exposure': exp25},
        'last_60_days': {'metrics': metrics60, 'exposure': exp60} if len(all_dates) >= 60 else None,
    }, f, indent=2, default=str)
print(f'\n📄 {OUTPUT_DIR}/sector_limit_results.json')
