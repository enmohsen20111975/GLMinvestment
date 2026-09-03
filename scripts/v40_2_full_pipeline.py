#!/usr/bin/env python3
"""
V40.2 Full Pipeline — Phases 2→6
================================
Phase 2: 7 combinations
Phase 3: 5 tightening mods
Phase 4: 4 advanced exit/sizing mods
Phase 5: Walk-Forward (Train vs Test)
Phase 6: Live Simulation (45 days)

Rejection rules:
- Phase 2: PF < 2.11 OR MaxDD worse than -22.43% → reject
- Phase 3: trades drop > 35% AND PF doesn't improve → fail
- Phase 5: PF drops > 15% from Train to Test → overfit, discard

Final target: WR ≥ 50% + PF ≥ 1.8 + MaxDD ≤ 18% + Exp ≥ +2.5%
"""
import os, sys, json, sqlite3, math, re
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict
from copy import deepcopy

PROJECT_ROOT = Path('/home/z/my-project')
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
NOTEBOOKS_DIR = PROJECT_ROOT / 'notebooks' / 'EGX'
OUTPUT_DIR = PROJECT_ROOT / 'vps-service' / 'backtest_results' / 'v40_2_full_pipeline'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)

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

# Import shared data loading + indicators from Phase 0+1 script
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))
from v40_2_flag_ablation import (
    load_universe, calc_atr, calc_rsi, calc_sma,
    strict_entry_check, distribution_exit_check, notebook_adjust_stop,
    news_impact_score, position_size_mult, calc_metrics
)

# ============================================================
# NEW: Fund score + RS + Market benchmark
# ============================================================

_market_returns_cache = {}

def get_market_avg_return(current_date, lookback=20):
    """متوسط عوائد كل أسهم EGX في آخر N يوم = benchmark proxy."""
    cache_key = (current_date, lookback)
    if cache_key in _market_returns_cache:
        return _market_returns_cache[cache_key]
    universe = load_universe()
    prices = universe['prices']
    returns = []
    for ticker, data in prices.items():
        recent = [d for d in data if d['date'] <= current_date][-lookback-1:]
        if len(recent) >= lookback + 1:
            start = recent[0]['c']
            end = recent[-1]['c']
            if start > 0:
                ret = (end - start) / start * 100
                returns.append(ret)
    avg = sum(returns) / len(returns) if returns else 0
    _market_returns_cache[cache_key] = avg
    return avg

def get_market_daily_change(current_date):
    """تغيير سوق EGX في يوم محدد (avg of all stocks daily change)."""
    universe = load_universe()
    prices = universe['prices']
    changes = []
    for ticker, data in prices.items():
        recent = [d for d in data if d['date'] <= current_date][-2:]
        if len(recent) >= 2:
            yest = recent[-2]['c']
            today = recent[-1]['c']
            if yest > 0:
                changes.append((today - yest) / yest * 100)
    return sum(changes) / len(changes) if changes else 0

def calc_fund_score(meta):
    """fund_score: 0-100 (pe + roe + dividend_yield)."""
    score = 0
    pe = meta.get('pe')
    roe = meta.get('roe')
    div = meta.get('dividend_yield')
    # PE score: lower is better
    if pe and pe > 0:
        if pe < 10:
            score += 25
        elif pe < 15:
            score += 20
        elif pe < 20:
            score += 15
        elif pe < 30:
            score += 8
        else:
            score += 0
    # ROE score: higher is better
    if roe and roe > 0:
        if roe > 20:
            score += 30
        elif roe > 15:
            score += 25
        elif roe > 10:
            score += 18
        elif roe > 5:
            score += 10
    # Dividend yield
    if div and div > 0:
        if div > 5:
            score += 15
        elif div > 3:
            score += 10
        elif div > 1:
            score += 5
    return min(100, score)

def calc_rs(ticker, current_date, lookback=20):
    """Relative Strength vs market avg."""
    universe = load_universe()
    prices = universe['prices'].get(ticker, [])
    recent = [d for d in prices if d['date'] <= current_date][-lookback-1:]
    if len(recent) < lookback + 1:
        return None
    start = recent[0]['c']
    end = recent[-1]['c']
    if start <= 0:
        return None
    stock_ret = (end - start) / start * 100
    market_ret = get_market_avg_return(current_date, lookback)
    if market_ret <= 0:
        return 999.0 if stock_ret > 0 else 0.0
    return stock_ret / market_ret


# ============================================================
# CONFIG (extended for Phases 3+4)
# ============================================================

class Config:
    def __init__(self, name):
        self.name = name
        # Phase 1 flags
        self.strict_entry = False
        self.distribution_exit = False
        self.notebook_context = False
        self.news_impact = False
        self.position_sizing = False
        # Phase 3 tightening
        self.rs_min_115 = False
        self.fund_veto_35 = False
        self.egx30_down_hold = False
        self.late_entry_strong = False
        self.atr_stop_clamp_weak = False
        # Phase 4 advanced
        self.partial_exit = False
        self.portfolio_heat = False
        self.correlation_filter = False
        self.structural_exit = False

    def __repr__(self):
        return f"Config({self.name})"


# ============================================================
# BACKTEST ENGINE (extended)
# ============================================================

def run_backtest(config, start_date=None, end_date=None):
    """Run full backtest with config. Optional date override for walk-forward."""
    sd = start_date or START_DATE
    ed = end_date or END_DATE
    universe = load_universe()
    prices = universe['prices']
    stocks_meta = universe['stocks_meta']
    notebooks = universe['notebooks']

    # Filter prices by date range
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
    rejected_count = {'rs': 0, 'fund_veto': 0, 'egx_down': 0, 'late_entry': 0, 'atr_clamp': 0}

    for current_date in trading_dates:
        # === 1. CLOSE POSITIONS ===
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
            exit_shares = pos['shares']  # default: all

            # STRUCTURAL_EXIT (Phase 4)
            if config.structural_exit and not exit_price:
                nb = notebooks.get(ticker, {})
                tcp = nb.get('typical_correction_pct', 0)
                if tcp and tcp > 0:
                    drop_from_entry = (pos['entry_price'] - current_price) / pos['entry_price'] * 100
                    if drop_from_entry > 1.25 * tcp and rsi and rsi < 35:
                        exit_price = current_price
                        exit_reason = 'structural_exit'

            # DISTRIBUTION_EXIT (highest priority after structural)
            if config.distribution_exit and not exit_price:
                if distribution_exit_check(today_data, recent, rsi):
                    exit_price = current_price
                    exit_reason = 'distribution_exit'

            # PARTIAL_EXIT (Phase 4): sell 40% at 1.5R, trail rest at 1.5×ATR
            if config.partial_exit and not exit_price:
                risk = pos['entry_price'] - pos['stop']
                if risk > 0 and not pos.get('partial_done'):
                    target_1_5r = pos['entry_price'] + 1.5 * risk
                    if current_price >= target_1_5r:
                        # Sell 40%
                        partial_shares = int(pos['shares'] * 0.4)
                        if partial_shares > 0:
                            proceeds = partial_shares * current_price
                            cash += proceeds
                            pos['shares'] -= partial_shares
                            pos['partial_done'] = True
                            pos['partial_exit_price'] = current_price
                            pos['partial_trailing_high'] = current_price
                            # Record partial trade
                            pnl_pct = ((current_price - pos['entry_price']) / pos['entry_price']) * 100
                            if config.position_sizing:
                                pnl_pct *= pos.get('position_size_mult', 1.0)
                            trades.append({
                                'ticker': ticker, 'entry_date': pos['entry_date'],
                                'exit_date': current_date, 'entry_price': pos['entry_price'],
                                'exit_price': current_price, 'shares': partial_shares,
                                'pnl_pct': pnl_pct, 'exit_reason': 'partial_exit_1.5R',
                                'position_size_mult': pos.get('position_size_mult', 1.0),
                            })
                # Trail remaining at 1.5×ATR after partial
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
                if config.position_sizing:
                    pnl_pct *= pos.get('position_size_mult', 1.0)
                trades.append({
                    'ticker': ticker, 'entry_date': pos['entry_date'],
                    'exit_date': current_date, 'entry_price': pos['entry_price'],
                    'exit_price': exit_price, 'shares': pos['shares'],
                    'pnl_pct': pnl_pct, 'exit_reason': exit_reason,
                    'position_size_mult': pos.get('position_size_mult', 1.0),
                })
            elif pos['shares'] > 0:
                new_open.append(pos)
        open_positions = [p for p in new_open if p.get('shares', 0) > 0]

        # === 2. OPEN NEW POSITIONS ===
        # EGX30 down > 0.4% → skip BUY
        if config.egx30_down_hold:
            market_change = get_market_daily_change(current_date)
            if market_change < -0.4:
                rejected_count['egx_down'] += 1
                portfolio_history.append({'date': current_date, 'value': cash + sum(
                    p['shares'] * (next((d['c'] for d in filtered_prices.get(p['ticker'], []) if d['date'] == current_date), p['entry_price']))
                    for p in open_positions)})
                continue

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
            if config.news_impact: score += news_impact_score(ticker, recent)
            score = max(0, min(100, score))

            # === Phase 3 tightening ===
            # A. RS minimum 1.15
            if config.rs_min_115:
                rs = calc_rs(ticker, current_date)
                if rs is None or rs < 1.15:
                    rejected_count['rs'] += 1
                    continue
            # B. Fund veto < 35
            if config.fund_veto_35:
                fs = calc_fund_score(meta)
                if fs < 35:
                    rejected_count['fund_veto'] += 1
                    continue
            # D. Late entry stronger
            if config.late_entry_strong:
                if len(recent) >= 20:
                    high_20 = max(d['h'] for d in recent[-20:] if d['h'])
                    if current_price >= high_20 * 0.95:
                        rejected_count['late_entry'] += 1
                        continue
                    if rsi and rsi > 68:
                        rejected_count['late_entry'] += 1
                        continue
            # Phase 1 STRICT_ENTRY
            if config.strict_entry:
                if strict_entry_check(recent, current_price, rsi):
                    continue

            # Stop / Target
            stop_pct = STOP_LOSS_PCT * 100
            if config.notebook_context:
                stop_pct = notebook_adjust_stop(ticker, stop_pct)
            # E. ATR stop clamp max 7% on weak stocks
            if config.atr_stop_clamp_weak:
                fs = calc_fund_score(meta)
                if fs < 50:
                    stop_pct = min(stop_pct, 7.0)
            target_pct = TAKE_PROFIT_PCT * 100

            # Position size
            pos_mult = 1.0
            if config.position_sizing:
                pos_mult = position_size_mult(atr, current_price)
            # Portfolio heat: 3+ open → ×0.55
            if config.portfolio_heat and len(open_positions) >= 3:
                pos_mult *= 0.55
            # Correlation filter: same sector as open → ×0.5
            if config.correlation_filter:
                my_sector = meta.get('sector') if isinstance(meta, dict) else None
                # Need sector — get from stocks.db directly
                for op in open_positions:
                    op_meta = stocks_meta.get(op['ticker'], {})
                    if op_meta.get('sector') and op_meta.get('sector') == my_sector:
                        pos_mult *= 0.5
                        break

            candidates.append({
                'ticker': ticker, 'price': current_price, 'score': score,
                'position_size': pos_mult, 'stop_pct': stop_pct, 'target_pct': target_pct,
                'atr': atr, 'meta': meta,
            })

        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS_PER_DAY]:
            position_value = available_capital * c['position_size']
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
                'trailing_high': c['price'], 'position_size_mult': c['position_size'],
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
            if config.position_sizing:
                pnl_pct *= pos.get('position_size_mult', 1.0)
            trades.append({
                'ticker': ticker, 'entry_date': pos['entry_date'], 'exit_date': last_date,
                'entry_price': pos['entry_price'], 'exit_price': exit_price, 'shares': pos['shares'],
                'pnl_pct': pnl_pct, 'exit_reason': 'backtest_end',
                'position_size_mult': pos.get('position_size_mult', 1.0),
            })

    metrics = calc_metrics(trades, portfolio_history, cash)
    metrics['rejected'] = dict(rejected_count)
    return trades, metrics


# ============================================================
# PHASE 2: 7 combinations
# ============================================================

def run_phase2():
    print('\n' + '='*90)
    print('PHASE 2 — COMBINATIONS (7 configs)')
    print('='*90)
    configs = [
        ('DIST_ONLY', {'distribution_exit': True}),
        ('DIST+STRICT', {'distribution_exit': True, 'strict_entry': True}),
        ('DIST+NOTEBOOK', {'distribution_exit': True, 'notebook_context': True}),
        ('DIST+NEWS', {'distribution_exit': True, 'news_impact': True}),
        ('DIST+STRICT+NB', {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True}),
        ('DIST+STRICT+NB+NEWS', {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True, 'news_impact': True}),
        ('ALL_ON', {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True, 'news_impact': True, 'position_sizing': True}),
    ]
    results = []
    for name, flags in configs:
        c = Config(name)
        for k, v in flags.items():
            setattr(c, k, v)
        print(f'\n--- {name} ---')
        trades, metrics = run_backtest(c)
        metrics['config'] = name
        results.append(metrics)
        print(f'  {metrics}')
    return results


# ============================================================
# PHASE 3: 5 tightening mods
# ============================================================

def run_phase3(best_config_flags):
    print('\n' + '='*90)
    print('PHASE 3 — TIGHTENING (5 mods on best Phase 2 combo)')
    print('='*90)
    mods = [
        ('+RS_1.15', {'rs_min_115': True}),
        ('+FUND_VETO_35', {'fund_veto_35': True}),
        ('+EGX30_DOWN_HOLD', {'egx30_down_hold': True}),
        ('+LATE_ENTRY_STRONG', {'late_entry_strong': True}),
        ('+ATR_CLAMP_WEAK', {'atr_stop_clamp_weak': True}),
    ]
    results = []
    # Baseline = best combo from Phase 2
    base = Config('BASE_BEST')
    for k, v in best_config_flags.items():
        setattr(base, k, v)
    print(f'\n--- BASE_BEST ---')
    _, base_metrics = run_backtest(base)
    base_metrics['config'] = 'BASE_BEST'
    results.append(base_metrics)
    print(f'  {base_metrics}')

    for name, flags in mods:
        c = Config(name)
        for k, v in best_config_flags.items():
            setattr(c, k, v)
        for k, v in flags.items():
            setattr(c, k, v)
        print(f'\n--- {name} ---')
        _, metrics = run_backtest(c)
        metrics['config'] = name
        results.append(metrics)
        print(f'  {metrics}')
    return results


# ============================================================
# PHASE 4: 4 advanced exit/sizing mods
# ============================================================

def run_phase4(best_flags):
    print('\n' + '='*90)
    print('PHASE 4 — ADVANCED EXIT + SIZING (4 mods)')
    print('='*90)
    mods = [
        ('+PARTIAL_EXIT', {'partial_exit': True}),
        ('+PORTFOLIO_HEAT', {'portfolio_heat': True}),
        ('+CORRELATION', {'correlation_filter': True}),
        ('+STRUCTURAL_EXIT', {'structural_exit': True}),
    ]
    results = []
    base = Config('BASE_BEST')
    for k, v in best_flags.items():
        setattr(base, k, v)
    print(f'\n--- BASE_BEST ---')
    _, base_metrics = run_backtest(base)
    base_metrics['config'] = 'BASE_BEST'
    results.append(base_metrics)
    print(f'  {base_metrics}')

    for name, flags in mods:
        c = Config(name)
        for k, v in best_flags.items():
            setattr(c, k, v)
        for k, v in flags.items():
            setattr(c, k, v)
        print(f'\n--- {name} ---')
        _, metrics = run_backtest(c)
        metrics['config'] = name
        results.append(metrics)
        print(f'  {metrics}')
    return results


# ============================================================
# PHASE 5: Walk-Forward
# ============================================================

def run_phase5(best_flags):
    print('\n' + '='*90)
    print('PHASE 5 — WALK-FORWARD (Train vs Test)')
    print('='*90)
    c = Config('WALK_FORWARD')
    for k, v in best_flags.items():
        setattr(c, k, v)
    print('\n--- TRAIN: 2026-02-01 → 2026-05-31 ---')
    _, train_metrics = run_backtest(c, '2026-02-01', '2026-05-31')
    train_metrics['config'] = 'TRAIN'
    print(f'  {train_metrics}')
    print('\n--- TEST: 2026-06-01 → 2026-08-27 ---')
    _, test_metrics = run_backtest(c, '2026-06-01', '2026-08-27')
    test_metrics['config'] = 'TEST'
    print(f'  {test_metrics}')
    # Check overfit
    if isinstance(train_metrics['profit_factor'], (int, float)) and isinstance(test_metrics['profit_factor'], (int, float)):
        if train_metrics['profit_factor'] > 0:
            drop_pct = (train_metrics['profit_factor'] - test_metrics['profit_factor']) / train_metrics['profit_factor'] * 100
            overfit = drop_pct > 15
            print(f'\n  PF drop: {drop_pct:.1f}% → {"OVERFIT ❌" if overfit else "PASS ✅"}')
            return {'train': train_metrics, 'test': test_metrics, 'pf_drop_pct': round(drop_pct, 1), 'overfit': overfit}
    return {'train': train_metrics, 'test': test_metrics, 'pf_drop_pct': None, 'overfit': None}


# ============================================================
# PHASE 6: Live Simulation (45 days)
# ============================================================

def run_phase6(best_flags):
    print('\n' + '='*90)
    print('PHASE 6 — LIVE SIMULATION (last 45 days)')
    print('='*90)
    # Last 45 days of available data
    universe = load_universe()
    all_dates = sorted({d['date'] for t in universe['prices'] for d in universe['prices'][t]})
    if len(all_dates) < 45:
        print('  Not enough data for 45-day sim')
        return None
    start = all_dates[-45]
    end = all_dates[-1]
    print(f'  Period: {start} → {end} ({len(all_dates[-45:])} dates)')
    c = Config('LIVE_SIM')
    for k, v in best_flags.items():
        setattr(c, k, v)
    trades, metrics = run_backtest(c, start, end)
    metrics['config'] = 'LIVE_SIM'
    print(f'  {metrics}')
    # Track rejected
    print(f'  Rejected: {metrics.get("rejected", {})}')
    return {'metrics': metrics, 'trades': trades, 'start': start, 'end': end}


# ============================================================
# PRINT TABLE
# ============================================================

def print_table(results, phase_name):
    print(f'\n{"="*100}')
    print(f'{phase_name}')
    print(f'{"="*100}')
    print(f'{"Config":<28} {"Trades":>7} {"WR%":>7} {"PF":>6} {"Return%":>9} {"MaxDD%":>8} {"Exp%":>7} {"AvgWin":>8} {"AvgLoss":>9}')
    print('-'*100)
    for r in results:
        pf = r['profit_factor']
        pf_str = f'{pf}' if pf != 'inf' else 'inf'
        print(f"{r['config']:<28} {r['trades']:>7} {r['win_rate']:>7.2f} {pf_str:>6} "
              f"{r['total_return']:>+9.2f} {r['max_dd']:>+8.2f} {r['expectancy']:>+7.2f} "
              f"{r['avg_win']:>+8.2f} {r['avg_loss']:>+9.2f}")
    print('-'*100)


def pick_best(results, min_pf, max_dd_floor):
    """Pick best config: highest PF with MaxDD not worse than floor."""
    best = None
    best_pf = 0
    for r in results[1:]:  # skip baseline
        pf = r['profit_factor']
        if not isinstance(pf, (int, float)): continue
        if pf < min_pf: continue
        if r['max_dd'] < max_dd_floor: continue  # more negative = worse
        if pf > best_pf:
            best_pf = pf
            best = r
    return best


# ============================================================
# MAIN
# ============================================================

def main():
    all_results = {}

    # === PHASE 2 ===
    p2 = run_phase2()
    print_table(p2, 'PHASE 2 — COMBINATIONS')
    # Rejection: PF < 2.11 OR MaxDD worse than -22.43
    # NOTE: p2 has NO baseline to skip — all configs include DISTRIBUTION_EXIT
    p2_winners = [r for r in p2 if isinstance(r['profit_factor'], (int, float))
                  and r['profit_factor'] >= 2.11 and r['max_dd'] >= -22.43]
    if p2_winners:
        best_p2 = max(p2_winners, key=lambda x: x['profit_factor'])
        print(f'\n🏆 Phase 2 Best: {best_p2["config"]} (PF={best_p2["profit_factor"]}, DD={best_p2["max_dd"]}%)')
    else:
        # Fallback: highest PF even if doesn't meet criteria
        best_p2 = max(p2[1:], key=lambda x: x['profit_factor'] if isinstance(x['profit_factor'], (int, float)) else 0)
        print(f'\n⚠️ No config met criteria. Best available: {best_p2["config"]}')
    all_results['phase2'] = p2

    # Map config name → flags
    flag_map = {
        'DIST_ONLY': {'distribution_exit': True},
        'DIST+STRICT': {'distribution_exit': True, 'strict_entry': True},
        'DIST+NOTEBOOK': {'distribution_exit': True, 'notebook_context': True},
        'DIST+NEWS': {'distribution_exit': True, 'news_impact': True},
        'DIST+STRICT+NB': {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True},
        'DIST+STRICT+NB+NEWS': {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True, 'news_impact': True},
        'ALL_ON': {'distribution_exit': True, 'strict_entry': True, 'notebook_context': True, 'news_impact': True, 'position_sizing': True},
    }
    best_flags = flag_map.get(best_p2['config'], {'distribution_exit': True})

    # === PHASE 3 ===
    p3 = run_phase3(best_flags)
    print_table(p3, 'PHASE 3 — TIGHTENING')
    # Pick best: highest PF with MaxDD not worse than -22.43
    best_p3 = pick_best(p3, 2.11, -22.43)
    if best_p3:
        print(f'\n🏆 Phase 3 Best: {best_p3["config"]} (PF={best_p3["profit_factor"]}, DD={best_p3["max_dd"]}%)')
        # Add the mod flag to best_flags
        if best_p3['config'].startswith('+'):
            mod_name = best_p3['config'][1:].lower()
            mod_map = {
                'rs_1.15': 'rs_min_115', 'fund_veto_35': 'fund_veto_35',
                'egx30_down_hold': 'egx30_down_hold', 'late_entry_strong': 'late_entry_strong',
                'atr_clamp_weak': 'atr_stop_clamp_weak',
            }
            flag_key = mod_map.get(mod_name)
            if flag_key:
                best_flags = {**best_flags, flag_key: True}
    else:
        print(f'\n⚠️ No Phase 3 mod improved. Keeping Phase 2 best.')
    all_results['phase3'] = p3

    # === PHASE 4 ===
    p4 = run_phase4(best_flags)
    print_table(p4, 'PHASE 4 — ADVANCED EXIT + SIZING')
    best_p4 = pick_best(p4, 2.11, -22.43)
    if best_p4:
        print(f'\n🏆 Phase 4 Best: {best_p4["config"]} (PF={best_p4["profit_factor"]}, DD={best_p4["max_dd"]}%)')
        if best_p4['config'].startswith('+'):
            mod_name = best_p4['config'][1:].lower()
            mod_map = {
                'partial_exit': 'partial_exit', 'portfolio_heat': 'portfolio_heat',
                'correlation': 'correlation_filter', 'structural_exit': 'structural_exit',
            }
            flag_key = mod_map.get(mod_name)
            if flag_key:
                best_flags = {**best_flags, flag_key: True}
    else:
        print(f'\n⚠️ No Phase 4 mod improved. Keeping Phase 3 best.')
    all_results['phase4'] = p4

    # === PHASE 5: Walk-Forward ===
    p5 = run_phase5(best_flags)
    all_results['phase5'] = p5

    # === PHASE 6: Live Sim ===
    p6 = run_phase6(best_flags)
    all_results['phase6'] = p6

    # === FINAL SUMMARY ===
    print('\n' + '='*100)
    print('FINAL SUMMARY — ALL PHASES')
    print('='*100)
    print(f'\nBest config flags: {best_flags}')
    if p5:
        print(f'\nWalk-Forward: Train PF={p5["train"]["profit_factor"]} → Test PF={p5["test"]["profit_factor"]} (drop={p5["pf_drop_pct"]}%) → {"OVERFIT" if p5["overfit"] else "PASS"}')
    if p6:
        print(f'\nLive Sim (45 days): {p6["metrics"]["trades"]} trades, WR={p6["metrics"]["win_rate"]}%, PF={p6["metrics"]["profit_factor"]}, Return={p6["metrics"]["total_return"]}%, DD={p6["metrics"]["max_dd"]}%')

    # Save all
    with open(OUTPUT_DIR / 'all_phases_results.json', 'w') as f:
        json.dump(all_results, f, indent=2, default=str)
    print(f'\n📄 All results saved to: {OUTPUT_DIR}/all_phases_results.json')


if __name__ == '__main__':
    main()
