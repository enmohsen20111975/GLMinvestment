#!/usr/bin/env python3
"""
V40.2 Backtest Engine — Modular Flag Testing
=============================================
المرحلة 0 + 1: Baseline + كل flag لوحده

Flags:
  - V40_2_STRICT_ENTRY: رفض late entry (قريب من قمة 20 يوم < 6% أو RSI > 65 أو +15% في 5 أيام)
  - V40_2_DISTRIBUTION_EXIT: خروج عند distribution pattern (red + upper_wick + volume spike + near high + RSI>65)
  - V40_2_NOTEBOOK_CONTEXT: استخدام typical_correction_pct لضبط الـ stop
  - V40_2_NEWS_IMPACT: محاكاة تأثير الأخبار (big move = news event → score delta)
  - POSITION_SIZING: volatility-based size (HIGH vol = 55%, NORMAL = 80%, LOW = 100%)

Fixed period: 2026-02-01 → 2026-08-27
Fixed universe: EGX stocks with screener tags + fundamentals
Fixed capital: 100,000 EGP, 10% per position
"""
import os
import sys
import json
import sqlite3
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path('/home/z/my-project')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')
NOTEBOOKS_DIR = PROJECT_ROOT / 'notebooks' / 'EGX'

# === FIXED BACKTEST PARAMS (لا تتغير بين الـ runs) ===
START_DATE = '2026-02-01'
END_DATE = '2026-08-27'
SCAN_INTERVAL = 5
MAX_PICKS_PER_DAY = 5
INITIAL_CAPITAL = 100_000
POSITION_SIZE_PCT = 0.10
STOP_LOSS_PCT = 0.07
TAKE_PROFIT_PCT = 0.20
TRAILING_STOP_PCT = 0.10
MIN_HISTORY_DAYS = 30

# === OUTPUT ===
OUTPUT_DIR = PROJECT_ROOT / 'vps-service' / 'backtest_results' / 'v40_2_flag_ablation'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)


# ============================================================
# DATA LOADERS (تشغل مرة واحدة وتبقى في الذاكرة)
# ============================================================

_data_cache = {}

def load_universe():
    """تحميل كل البيانات مرة واحدة + فلترة EGX-only (منع ticker contamination)."""
    if 'universe' in _data_cache:
        return _data_cache['universe']

    print('[LOAD] Loading universe (screener + fundamentals + price history + notebooks)...')
    print('[LOAD] ⚠️ Filtering EGX-only to prevent ticker contamination (EGX vs TADAWUL same symbol)')

    # 1. Get EGX-only tickers from stocks.db (the canonical source for market identification)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_s = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    cur = conn_s.execute('''
        SELECT ticker, name, current_price, pe_ratio, pb_ratio, roe, roa,
               dividend_yield, market_cap, beta, ma_50, ma_200, rsi,
               support, resistance, high_52w, low_52w
        FROM stocks
        WHERE market IN ('EGX', 'مصر') AND is_active = 1
        AND current_price IS NOT NULL AND current_price > 0
    ''')
    stocks_meta = {}
    egx_tickers = set()
    for row in cur.fetchall():
        (ticker, name, price, pe, pb, roe, roa, div_yield, mc, beta,
         ma50, ma200, rsi, support, resistance, high52w, low52w) = row
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
        }
        egx_tickers.add(ticker)
    conn_s.close()
    print(f'[LOAD] EGX tickers in stocks.db: {len(egx_tickers)}')

    # 2. Screener tickers (intersect with EGX)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    cur = conn.execute('''
        SELECT DISTINCT symbol FROM screener_lists
        WHERE category IN ('most_active', 'unusual_volume', 'top_gainers')
        AND market = 'مصر'
    ''')
    screener_tickers = sorted({r[0] for r in cur.fetchall()} & egx_tickers)
    print(f'[LOAD] Screener ∩ EGX: {len(screener_tickers)}')

    # 3. Price history — filter to EGX-only tickers + sanity-check price range
    # egksco_price_history mixes EGX + TADAWUL under same symbol.
    # We filter: only keep rows where close_price is within 50%-200% of stocks.db.current_price
    placeholders = ','.join('?' * len(screener_tickers))
    cur = conn.execute(f'''
        SELECT symbol, price_date, open_price, high_price, low_price, close_price, volume
        FROM egksco_price_history
        WHERE symbol IN ({placeholders})
        AND price_date >= ? AND price_date <= ?
        ORDER BY symbol, price_date ASC
    ''', [*screener_tickers, START_DATE, END_DATE])
    prices = defaultdict(list)
    price_filter_stats = {'kept': 0, 'rejected': 0}
    for row in cur.fetchall():
        symbol, date, o, h, l, c, v = row
        if not c or c <= 0:
            continue
        # Sanity check: price must be within 20%-500% of stocks.db.current_price
        # (allows for normal movement, rejects TADAWUL contamination where prices are 100x different)
        ref_price = stocks_meta.get(symbol, {}).get('price', 0)
        if ref_price > 0:
            ratio = c / ref_price
            if ratio < 0.2 or ratio > 5.0:
                price_filter_stats['rejected'] += 1
                continue
        prices[symbol].append({'date': date, 'o': o or 0, 'h': h or 0, 'l': l or 0, 'c': c, 'v': v or 0})
        price_filter_stats['kept'] += 1
    conn.close()
    print(f'[LOAD] Price rows: {price_filter_stats["kept"]} kept, {price_filter_stats["rejected"]} rejected (contamination)')

    # 4. Notebooks
    notebooks = {}
    if NOTEBOOKS_DIR.exists():
        for nb_file in NOTEBOOKS_DIR.glob('*.json'):
            ticker = nb_file.stem
            if ticker not in egx_tickers:
                continue
            try:
                with open(nb_file) as f:
                    nb = json.load(f)
                notebooks[ticker] = nb.get('machine_summary', {})
            except Exception:
                pass

    universe = {
        'screener_tickers': screener_tickers,
        'stocks_meta': stocks_meta,
        'prices': dict(prices),
        'notebooks': notebooks,
    }
    _data_cache['universe'] = universe
    print(f'[LOAD] Done: {len(screener_tickers)} EGX screener, {len(stocks_meta)} with meta, '
          f'{len(prices)} with price history, {len(notebooks)} notebooks')
    return universe


# ============================================================
# INDICATORS
# ============================================================

def calc_atr(price_data, period=14):
    if len(price_data) < period + 1:
        return None
    trs = []
    for i in range(1, len(price_data)):
        high = price_data[i]['h'] or 0
        low = price_data[i]['l'] or 0
        prev_close = price_data[i-1]['c'] or 0
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
    return sum(trs[-period:]) / period if len(trs) >= period else None

def calc_rsi(price_data, period=14):
    if len(price_data) < period + 1:
        return None
    gains, losses = [], []
    for i in range(1, len(price_data)):
        prev = price_data[i-1]['c'] or 0
        curr = price_data[i]['c'] or 0
        change = curr - prev
        gains.append(max(change, 0))
        losses.append(max(-change, 0))
    avg_gain = sum(gains[-period:]) / period
    avg_loss = sum(losses[-period:]) / period
    if avg_loss == 0:
        return 100.0
    rs = avg_gain / avg_loss
    return 100 - (100 / (1 + rs))

def calc_sma(price_data, period=20):
    if len(price_data) < period:
        return None
    return sum(d['c'] for d in price_data[-period:]) / period


# ============================================================
# FLAG LOGIC
# ============================================================

def strict_entry_check(recent, current_price, rsi):
    """V40_2_STRICT_ENTRY: رفض late entry."""
    if len(recent) < 20:
        return False  # not enough data → safe to allow
    # 1. Near 20-day high < 6%
    high_20 = max(d['h'] for d in recent[-20:] if d['h'])
    if current_price >= high_20 * 0.94:
        return True  # too close to high → REJECT
    # 2. RSI > 65
    if rsi and rsi > 65:
        return True  # overbought → REJECT
    # 3. +15% in 5 days
    if len(recent) >= 6:
        five_days_ago = recent[-6]['c'] or 0
        if five_days_ago > 0 and (current_price - five_days_ago) / five_days_ago > 0.15:
            return True  # already pumped → REJECT
    return False

def distribution_exit_check(today, recent, rsi):
    """V40_2_DISTRIBUTION_EXIT: detect distribution pattern."""
    if len(recent) < 20 or not today:
        return False
    # 5 conditions
    # 1. Red candle
    if today['c'] >= today['o']:
        return False
    # 2. Upper wick >= body
    body = abs(today['o'] - today['c'])
    upper_wick = today['h'] - max(today['o'], today['c'])
    if upper_wick < body:
        return False
    # 3. Volume > 1.8x MA(20)
    avg_vol = sum(d['v'] for d in recent[-20:]) / 20
    if avg_vol <= 0 or today['v'] < avg_vol * 1.8:
        return False
    # 4. Near 20-day high <= 8%
    high_20 = max(d['h'] for d in recent[-20:] if d['h'])
    if today['c'] < high_20 * 0.92:
        return False
    # 5. RSI > 65
    if not rsi or rsi <= 65:
        return False
    return True  # distribution detected → EXIT

def notebook_adjust_stop(ticker, stop_pct):
    """V40_2_NOTEBOOK_CONTEXT: adjust stop based on typical_correction_pct."""
    nb = _data_cache.get('universe', {}).get('notebooks', {}).get(ticker, {})
    tcp = nb.get('typical_correction_pct', 0)
    if tcp and tcp > 0:
        # Use typical_correction as the stop (but clamp 3-9%)
        return max(3, min(9, tcp))
    return stop_pct

def news_impact_score(ticker, recent):
    """V40_2_NEWS_IMPACT: simulate news impact based on recent price action."""
    if len(recent) < 3:
        return 0
    # Big move in last 1-3 days = "news event"
    yesterday = recent[-2]['c'] if len(recent) >= 2 else 0
    today = recent[-1]['c'] if recent else 0
    if yesterday <= 0:
        return 0
    change_pct = (today - yesterday) / yesterday * 100
    # Map change to news level
    if change_pct > 5:
        return 8  # POSITIVE news
    elif change_pct > 2:
        return 5  # mild positive
    elif change_pct < -5:
        return -8  # NEGATIVE news
    elif change_pct < -2:
        return -5  # mild negative
    return 0

def position_size_mult(atr, close_price):
    """POSITION_SIZING: volatility-based."""
    if not atr or not close_price or close_price <= 0:
        return 1.0
    atr_pct = (atr / close_price) * 100
    if atr_pct >= 6:
        return 0.55
    elif atr_pct >= 3:
        return 0.80
    return 1.0


# ============================================================
# BACKTEST ENGINE
# ============================================================

class BacktestConfig:
    def __init__(self, name, strict_entry=False, distribution_exit=False,
                 notebook_context=False, news_impact=False, position_sizing=False):
        self.name = name
        self.strict_entry = strict_entry
        self.distribution_exit = distribution_exit
        self.notebook_context = notebook_context
        self.news_impact = news_impact
        self.position_sizing = position_sizing

    def __repr__(self):
        return f"Config({self.name})"


def run_backtest(config):
    """تشغيل backtest كامل بـ config معين."""
    universe = load_universe()
    prices = universe['prices']
    stocks_meta = universe['stocks_meta']

    # Build date index
    all_dates = sorted({d['date'] for t in prices for d in prices[t]})
    trading_dates = all_dates[::SCAN_INTERVAL]

    trades = []
    open_positions = []
    cash = INITIAL_CAPITAL
    portfolio_history = []

    for current_date in trading_dates:
        # 1. Close positions
        new_open = []
        for pos in open_positions:
            ticker = pos['ticker']
            if ticker not in prices:
                continue
            today_data = next((d for d in prices[ticker] if d['date'] == current_date), None)
            if not today_data:
                new_open.append(pos)
                continue

            current_price = today_data['c'] or today_data['o']
            if not current_price:
                new_open.append(pos)
                continue

            # Update trailing high
            if current_price > pos['trailing_high']:
                pos['trailing_high'] = current_price

            # Get recent for exit checks
            recent = [d for d in prices[ticker] if d['date'] <= current_date][-30:]
            rsi = calc_rsi(recent)

            exit_price = None
            exit_reason = None

            # DISTRIBUTION_EXIT check (highest priority)
            if config.distribution_exit:
                if distribution_exit_check(today_data, recent, rsi):
                    exit_price = current_price
                    exit_reason = 'distribution_exit'

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

            if exit_price:
                proceeds = pos['shares'] * exit_price
                cash += proceeds
                pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
                # Apply position sizing to PnL
                if config.position_sizing:
                    pnl_pct *= pos.get('position_size_mult', 1.0)
                trades.append({
                    'ticker': ticker,
                    'entry_date': pos['entry_date'],
                    'exit_date': current_date,
                    'entry_price': pos['entry_price'],
                    'exit_price': exit_price,
                    'shares': pos['shares'],
                    'pnl_pct': pnl_pct,
                    'exit_reason': exit_reason,
                    'position_size_mult': pos.get('position_size_mult', 1.0),
                })
            else:
                new_open.append(pos)
        open_positions = new_open

        # 2. Open new positions
        available_capital = cash * POSITION_SIZE_PCT
        candidates = []
        for ticker in prices:
            if any(p['ticker'] == ticker for p in open_positions):
                continue
            if ticker not in stocks_meta:
                continue
            today_data = next((d for d in prices[ticker] if d['date'] == current_date), None)
            if not today_data:
                continue
            current_price = today_data['c'] or today_data['o']
            if not current_price or current_price <= 0:
                continue

            recent = [d for d in prices[ticker] if d['date'] <= current_date][-30:]
            if len(recent) < MIN_HISTORY_DAYS:
                continue

            atr = calc_atr(recent)
            if not atr:
                continue
            rsi = calc_rsi(recent)
            ma20 = calc_sma(recent, 20)
            if not ma20:
                continue

            # Entry gate: price above MA20
            if current_price <= ma20:
                continue

            # Score (base + fundamentals)
            score = 50
            meta = stocks_meta[ticker]
            if meta['pe'] and meta['pe'] < 15:
                score += 15
            elif meta['pe'] and meta['pe'] < 25:
                score += 8
            if meta['roe'] and meta['roe'] > 15:
                score += 15
            elif meta['roe'] and meta['roe'] > 10:
                score += 8
            if rsi and rsi < 30:
                score += 10
            elif rsi and rsi > 70:
                score -= 10

            # Volume spike
            avg_vol = sum(d['v'] for d in recent[-5:]) / 5 if len(recent) >= 5 else 0
            if avg_vol > 0 and today_data['v'] > avg_vol * 1.5:
                score += 5

            # STRICT_ENTRY filter
            if config.strict_entry:
                if strict_entry_check(recent, current_price, rsi):
                    continue  # REJECT

            # NEWS_IMPACT
            if config.news_impact:
                score += news_impact_score(ticker, recent)

            # Clamp score
            score = max(0, min(100, score))

            # Stop / Target
            stop_pct = STOP_LOSS_PCT * 100
            if config.notebook_context:
                stop_pct = notebook_adjust_stop(ticker, stop_pct)

            target_pct = TAKE_PROFIT_PCT * 100

            # Position size
            pos_mult = 1.0
            if config.position_sizing:
                pos_mult = position_size_mult(atr, current_price)

            candidates.append({
                'ticker': ticker,
                'price': current_price,
                'score': score,
                'position_size': pos_mult,
                'stop_pct': stop_pct,
                'target_pct': target_pct,
            })

        # Pick top candidates
        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS_PER_DAY]:
            position_value = available_capital * c['position_size']
            if position_value < 1000:
                continue
            shares = int(position_value / c['price'])
            if shares <= 0:
                continue
            cost = shares * c['price']
            if cost > cash:
                continue
            cash -= cost
            open_positions.append({
                'ticker': c['ticker'],
                'entry_date': current_date,
                'entry_price': c['price'],
                'shares': shares,
                'stop': c['price'] * (1 - c['stop_pct'] / 100),
                'target': c['price'] * (1 + c['target_pct'] / 100),
                'trailing_high': c['price'],
                'position_size_mult': c['position_size'],
            })

        # Track portfolio value
        portfolio_value = cash
        for pos in open_positions:
            ticker = pos['ticker']
            today_data = next((d for d in prices[ticker] if d['date'] == current_date), None)
            if today_data:
                portfolio_value += pos['shares'] * (today_data['c'] or pos['entry_price'])
        portfolio_history.append({'date': current_date, 'value': portfolio_value})

    # Close remaining positions at last price
    last_date = trading_dates[-1] if trading_dates else None
    for pos in open_positions:
        ticker = pos['ticker']
        if ticker in prices:
            last_data = prices[ticker][-1]
            exit_price = last_data['c'] or pos['entry_price']
            proceeds = pos['shares'] * exit_price
            cash += proceeds
            pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
            if config.position_sizing:
                pnl_pct *= pos.get('position_size_mult', 1.0)
            trades.append({
                'ticker': ticker,
                'entry_date': pos['entry_date'],
                'exit_date': last_date,
                'entry_price': pos['entry_price'],
                'exit_price': exit_price,
                'shares': pos['shares'],
                'pnl_pct': pnl_pct,
                'exit_reason': 'backtest_end',
                'position_size_mult': pos.get('position_size_mult', 1.0),
            })

    return trades, portfolio_history, cash


# ============================================================
# METRICS
# ============================================================

def calc_metrics(trades, portfolio_history, final_cash):
    if not trades:
        return {
            'trades': 0, 'win_rate': 0, 'avg_win': 0, 'avg_loss': 0,
            'profit_factor': 0, 'total_return': 0, 'max_dd': 0, 'expectancy': 0,
            'final_capital': final_cash,
        }
    total = len(trades)
    wins = [t for t in trades if t['pnl_pct'] > 0]
    losses = [t for t in trades if t['pnl_pct'] <= 0]
    wr = (len(wins) / total) * 100 if total else 0
    avg_win = sum(t['pnl_pct'] for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t['pnl_pct'] for t in losses) / len(losses) if losses else 0
    total_return = ((final_cash - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100

    gross_profit = sum(t['pnl_pct'] for t in wins)
    gross_loss = abs(sum(t['pnl_pct'] for t in losses))
    pf = gross_profit / gross_loss if gross_loss > 0 else float('inf')

    # Expectancy = (WR * avg_win) - (LR * avg_loss)
    lr = 100 - wr
    expectancy = (wr/100 * avg_win) - (lr/100 * abs(avg_loss))

    # Max drawdown
    peak = INITIAL_CAPITAL
    max_dd = 0
    for ph in portfolio_history:
        if ph['value'] > peak:
            peak = ph['value']
        dd = ((ph['value'] - peak) / peak) * 100 if peak > 0 else 0
        if dd < max_dd:
            max_dd = dd

    return {
        'trades': total,
        'win_rate': round(wr, 2),
        'avg_win': round(avg_win, 2),
        'avg_loss': round(avg_loss, 2),
        'profit_factor': round(pf, 2) if pf != float('inf') else 'inf',
        'total_return': round(total_return, 2),
        'max_dd': round(max_dd, 2),
        'expectancy': round(expectancy, 2),
        'final_capital': round(final_cash, 2),
    }


# ============================================================
# MAIN: Run all configs
# ============================================================

def main():
    configs = [
        BacktestConfig('BASELINE', strict_entry=False, distribution_exit=False,
                       notebook_context=False, news_impact=False, position_sizing=False),
        BacktestConfig('STRICT_ENTRY', strict_entry=True),
        BacktestConfig('DISTRIBUTION_EXIT', distribution_exit=True),
        BacktestConfig('NOTEBOOK_CONTEXT', notebook_context=True),
        BacktestConfig('NEWS_IMPACT', news_impact=True),
        BacktestConfig('POSITION_SIZING', position_sizing=True),
    ]

    results = []
    for config in configs:
        print(f'\n{"="*70}')
        print(f'Running: {config.name}')
        print(f'  strict_entry={config.strict_entry}, distribution_exit={config.distribution_exit}')
        print(f'  notebook_context={config.notebook_context}, news_impact={config.news_impact}')
        print(f'  position_sizing={config.position_sizing}')
        print(f'{"="*70}')

        trades, portfolio_history, final_cash = run_backtest(config)
        metrics = calc_metrics(trades, portfolio_history, final_cash)
        metrics['config'] = config.name
        results.append(metrics)

        print(f'\n  Results: {metrics}')

        # Save individual trades
        trades_file = OUTPUT_DIR / f'trades_{config.name}.csv'
        with open(trades_file, 'w') as f:
            f.write('ticker,entry_date,exit_date,entry_price,exit_price,shares,pnl_pct,exit_reason,pos_mult\n')
            for t in trades:
                f.write(f"{t['ticker']},{t['entry_date']},{t['exit_date']},{t['entry_price']:.2f},{t['exit_price']:.2f},{t['shares']},{t['pnl_pct']:.2f},{t['exit_reason']},{t['position_size_mult']:.2f}\n")

    # === FINAL COMPARISON TABLE ===
    print('\n' + '='*90)
    print('FINAL COMPARISON TABLE — Phase 0 (Baseline) + Phase 1 (Each Flag Alone)')
    print('='*90)
    print(f'{"Config":<22} {"Trades":>7} {"WR%":>7} {"PF":>6} {"Return%":>9} {"MaxDD%":>8} {"Exp%":>7} {"AvgWin":>8} {"AvgLoss":>9}')
    print('-'*90)
    for r in results:
        pf = r['profit_factor']
        pf_str = f'{pf}' if pf != 'inf' else 'inf'
        print(f"{r['config']:<22} {r['trades']:>7} {r['win_rate']:>7.2f} {pf_str:>6} "
              f"{r['total_return']:>+9.2f} {r['max_dd']:>+8.2f} {r['expectancy']:>+7.2f} "
              f"{r['avg_win']:>+8.2f} {r['avg_loss']:>+9.2f}")
    print('-'*90)

    # === WINNERS / LOSERS ===
    baseline = results[0]
    print(f'\n{"="*70}')
    print(f'VERDICT (compared to BASELINE: PF={baseline["profit_factor"]}, DD={baseline["max_dd"]}%)')
    print(f'{"="*70}')
    for r in results[1:]:
        verdict = []
        if isinstance(r['profit_factor'], (int, float)) and isinstance(baseline['profit_factor'], (int, float)):
            if r['profit_factor'] > baseline['profit_factor']:
                verdict.append('✓ PF higher')
            else:
                verdict.append('✗ PF lower')
        # For DD: lower (more negative) is worse, higher (less negative) is better
        # e.g. -22 is better than -30
        if r['max_dd'] > baseline['max_dd']:  # -22 > -30 → better
            verdict.append('✓ DD better')
        else:
            verdict.append('✗ DD worse')
        if r['win_rate'] > baseline['win_rate']:
            verdict.append('✓ WR higher')
        else:
            verdict.append('✗ WR lower')

        is_winner = (isinstance(r['profit_factor'], (int, float)) and
                     isinstance(baseline['profit_factor'], (int, float)) and
                     r['profit_factor'] >= baseline['profit_factor'] and
                     r['max_dd'] >= baseline['max_dd'])  # DD >= baseline means less negative
        status = '🏆 WINNER' if is_winner else '❌ LOSER'
        print(f'{r["config"]:<22} → {status} ({", ".join(verdict)})')

    # Save JSON
    with open(OUTPUT_DIR / 'phase_0_1_results.json', 'w') as f:
        json.dump(results, f, indent=2, default=str)
    print(f'\n📄 Results saved to: {OUTPUT_DIR}/phase_0_1_results.json')


if __name__ == '__main__':
    main()
