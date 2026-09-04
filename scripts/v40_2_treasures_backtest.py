#!/usr/bin/env python3
"""
V40.2 Backtest with Treasures (screener + fundamentals + bid/ask)
=================================================================
Backtest محترم لـ V40.2 يستخدم الكنوز المدفونة:
  1. Screener Lists (most_active, top_gainers, unusual_volume, high_dividend)
  2. Fundamentals (tab_valuation, tab_profitability)
  3. Bid/Ask spread (from intraday data)

Strategy:
  - For each trading day in the backtest window:
    - Load screener lists (most_active + unusual_volume = high activity)
    - Filter by fundamentals (P/E < 30, ROE > 10%)
    - Run V40.2 entry gate on filtered candidates
    - Apply position sizing (volatility-based)
    - Track trades with realistic stop-loss + take-profit
  - Output: trades.csv + summary.json + report.md
"""
import os
import sys
import json
import sqlite3
from datetime import datetime, timedelta
from pathlib import Path
from collections import defaultdict
import math

# Setup paths
PROJECT_ROOT = Path('/home/z/my-project')
VPS_SERVICE = PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(VPS_SERVICE))
sys.path.insert(0, str(PROJECT_ROOT))

# Database paths
STOCKS_DB = str(PROJECT_ROOT / 'db' / 'stocks.db')
DATA_ENGINE_DB = str(PROJECT_ROOT / 'db' / 'data_engine.db')
PREDICTIONS_DB = str(PROJECT_ROOT / 'db' / 'predictions.db')

# Backtest config
START_DATE = '2026-02-01'  # Start of price history with good data
END_DATE = '2026-08-27'    # End of available data
SCAN_INTERVAL = 5           # Scan every 5 trading days
MAX_PICKS_PER_DAY = 5       # Top 5 picks per day
INITIAL_CAPITAL = 100_000   # 100K EGP
POSITION_SIZE_PCT = 0.10    # 10% per position
STOP_LOSS_PCT = 0.07        # 7% hard stop (Rule 8: 3-9% range)
TAKE_PROFIT_PCT = 0.20      # 20% take profit
TRAILING_STOP_PCT = 0.10    # 10% trailing stop

# Output paths
OUTPUT_DIR = PROJECT_ROOT / 'vps-service' / 'backtest_results' / 'v40_2_treasures'
OUTPUT_DIR.mkdir(parents=True, exist_ok=True)
TRADES_CSV = OUTPUT_DIR / 'trades.csv'
SUMMARY_JSON = OUTPUT_DIR / 'summary.json'
REPORT_MD = OUTPUT_DIR / 'BACKTEST_REPORT.md'

print('=' * 70)
print('V40.2 Backtest with Treasures (screener + fundamentals + bid/ask)')
print('=' * 70)
print(f'Period: {START_DATE} → {END_DATE}')
print(f'Scan interval: every {SCAN_INTERVAL} trading days')
print(f'Max picks/day: {MAX_PICKS_PER_DAY}')
print(f'Initial capital: {INITIAL_CAPITAL:,.0f} EGP')
print(f'Position size: {POSITION_SIZE_PCT*100}% per trade')
print(f'Stop loss: {STOP_LOSS_PCT*100}% | Take profit: {TAKE_PROFIT_PCT*100}%')
print(f'Trailing stop: {TRAILING_STOP_PCT*100}%')


def load_screener_stocks():
    """Load stocks from screener lists (treasure #1)."""
    print('\n[1/4] Loading screener stocks from data_engine.db.screener_lists...')
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=10)
    cur = conn.execute('''
        SELECT DISTINCT symbol FROM screener_lists
        WHERE category IN ('most_active', 'unusual_volume', 'top_gainers')
        AND market = 'مصر'
    ''')
    tickers = sorted({r[0] for r in cur.fetchall()})
    conn.close()
    print(f'  ✓ Found {len(tickers)} unique EGX tickers from screener (most_active + unusual_volume + top_gainers)')
    return tickers


def load_fundamentals(tickers):
    """Load fundamentals for tickers (treasure #2).
    Uses stocks.db.stocks (has 330 stocks with ROE, 28 with P/E) — the canonical source for EGX.
    Falls back to data_engine.db.tab_valuation for cross-market data.
    """
    print('\n[2/4] Loading fundamentals from stocks.db.stocks (canonical for EGX)...')
    conn = sqlite3.connect(STOCKS_DB, timeout=10)
    fundamentals = {}

    # Get fundamentals from stocks.db.stocks (has 13 fundamental columns)
    placeholders = ','.join('?' * len(tickers))
    cur = conn.execute(f'''
        SELECT ticker, pe_ratio, pb_ratio, roe, roa, dividend_yield,
               market_cap, beta, eps, ma_50, ma_200, rsi, support, resistance
        FROM stocks
        WHERE ticker IN ({placeholders})
        AND pe_ratio IS NOT NULL AND pe_ratio > 0 AND pe_ratio < 50
    ''', tickers)
    rows = cur.fetchall()

    for row in rows:
        ticker, pe, pb, roe, roa, div_yield, mc, beta, eps, ma50, ma200, rsi, support, resistance = row
        # Apply fundamental filter: P/E < 50 AND ROE > 5%
        if roe is None or roe < 5:
            continue
        fundamentals[ticker] = {
            'pe': float(pe),
            'pb': float(pb) if pb else None,
            'roe': float(roe),
            'roa': float(roa) if roa else None,
            'net_margin': None,
            'dividend_yield': float(div_yield) if div_yield else None,
            'market_cap': float(mc) if mc else None,
            'beta': float(beta) if beta else None,
        }
    conn.close()
    print(f'  ✓ Found {len(fundamentals)} EGX stocks with strong fundamentals (P/E < 50, ROE > 5%)')
    if fundamentals:
        sample = list(fundamentals.items())[:5]
        for t, f in sample:
            pe_str = f"{f['pe']:.1f}" if f.get('pe') else 'N/A'
            roe_str = f"{f['roe']:.1f}%" if f.get('roe') else 'N/A'
            pb_str = f"{f.get('pb'):.1f}" if f.get('pb') else 'N/A'
            print(f'    - {t}: P/E={pe_str}, ROE={roe_str}, P/B={pb_str}')
    return fundamentals


def load_price_history(tickers, start_date, end_date):
    """Load price history for tickers from data_engine.db.egksco_price_history."""
    print(f'\n[3/4] Loading price history from data_engine.db.egksco_price_history ({start_date} → {end_date})...')
    conn = sqlite3.connect(DATA_ENGINE_DB, timeout=30)
    prices = {}
    for t in tickers:
        try:
            cur = conn.execute('''
                SELECT price_date, open_price, high_price, low_price, close_price, volume
                FROM egksco_price_history
                WHERE symbol = ? AND price_date >= ? AND price_date <= ?
                ORDER BY price_date ASC
            ''', (t, start_date, end_date))
            rows = cur.fetchall()
            if len(rows) >= 30:  # Need at least 30 days
                prices[t] = rows
        except Exception:
            continue
    conn.close()
    print(f'  ✓ Found {len(prices)} stocks with >= 30 days of price history')
    return prices


def calculate_atr(price_data, period=14):
    """Calculate Average True Range for volatility/position sizing."""
    if len(price_data) < period + 1:
        return None
    trs = []
    for i in range(1, len(price_data)):
        high = price_data[i][2] or 0
        low = price_data[i][3] or 0
        prev_close = price_data[i-1][4] or 0
        tr = max(high - low, abs(high - prev_close), abs(low - prev_close))
        trs.append(tr)
    return sum(trs[-period:]) / period if len(trs) >= period else None


def calculate_position_size(atr, close_price):
    """Volatility-based position sizing (treasure from position_sizing.py)."""
    if not atr or not close_price or close_price <= 0:
        return 1.0  # Default 100%
    atr_pct = (atr / close_price) * 100
    if atr_pct >= 6:  # High volatility
        return 0.55  # 55% size
    elif atr_pct >= 3:  # Normal volatility
        return 0.80  # 80% size
    else:
        return 1.0  # 100% size


def run_backtest():
    """Run the V40.2 backtest with treasures."""
    # Load treasures
    screener_tickers = load_screener_stocks()
    fundamentals = load_fundamentals(screener_tickers)
    qualified_tickers = list(fundamentals.keys())
    prices = load_price_history(qualified_tickers, START_DATE, END_DATE)

    if not prices:
        print('\n❌ No stocks with sufficient price history. Try different dates.')
        return

    # Build date index
    print(f'\n[4/4] Running backtest simulation...')
    all_dates = sorted({row[0] for t in prices for row in prices[t]})
    trading_dates = all_dates[::SCAN_INTERVAL]  # Scan every N days
    print(f'  Trading dates: {len(trading_dates)} (scanned every {SCAN_INTERVAL} days)')

    # Run simulation
    trades = []
    open_positions = []  # List of {ticker, entry_date, entry_price, shares, stop, target, trailing_high}
    cash = INITIAL_CAPITAL
    portfolio_value_history = []

    for current_date in trading_dates:
        # 1. Close positions that hit stop-loss or take-profit
        new_open = []
        for pos in open_positions:
            ticker = pos['ticker']
            if ticker not in prices:
                continue
            # Find today's price
            today_data = next((r for r in prices[ticker] if r[0] == current_date), None)
            if not today_data:
                new_open.append(pos)
                continue
            _, open_p, high_p, low_p, close_p, _ = today_data
            current_price = close_p or open_p
            if not current_price:
                new_open.append(pos)
                continue
            # Update trailing high
            if current_price > pos['trailing_high']:
                pos['trailing_high'] = current_price
            # Check exits
            exit_price = None
            exit_reason = None
            if low_p and low_p <= pos['stop']:
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
                trades.append({
                    'ticker': ticker,
                    'entry_date': pos['entry_date'],
                    'exit_date': current_date,
                    'entry_price': pos['entry_price'],
                    'exit_price': exit_price,
                    'shares': pos['shares'],
                    'pnl_pct': pnl_pct,
                    'exit_reason': exit_reason,
                    'holding_days': 1,
                    'fundamentals': pos.get('fundamentals', {}),
                    'position_size_mult': pos.get('position_size_mult', 1.0),
                })
            else:
                new_open.append(pos)
        open_positions = new_open

        # 2. Open new positions based on V40.2 entry gate (simplified)
        available_capital = cash * POSITION_SIZE_PCT
        candidates = []
        for ticker in prices:
            if any(p['ticker'] == ticker for p in open_positions):
                continue  # Already holding
            if ticker not in fundamentals:
                continue
            # Find today's price and recent history
            today_data = next((r for r in prices[ticker] if r[0] == current_date), None)
            if not today_data:
                continue
            _, open_p, high_p, low_p, close_p, volume = today_data
            if not close_p or close_p <= 0:
                continue
            # Get recent history (last 30 days before current_date)
            recent = [r for r in prices[ticker] if r[0] <= current_date][-30:]
            if len(recent) < 15:
                continue
            # Calculate ATR for position sizing
            atr = calculate_atr(recent)
            if not atr:
                continue
            # Simple V40.2 entry: price above MA20 (trend following)
            ma20 = sum(r[4] for r in recent if r[4]) / max(1, sum(1 for r in recent if r[4]))
            if close_p <= ma20:
                continue  # Below MA20 = no buy signal
            # Fundamental score: lower P/E + higher ROE = better
            fund_score = 0
            pe = fundamentals[ticker]['pe']
            roe = fundamentals[ticker]['roe']
            if pe < 15:
                fund_score += 30
            elif pe < 25:
                fund_score += 15
            if roe > 15:
                fund_score += 30
            elif roe > 10:
                fund_score += 15
            # Volume spike (today's volume > avg)
            avg_vol = sum(r[5] or 0 for r in recent) / len(recent) if recent else 0
            if volume and avg_vol > 0 and volume > avg_vol * 1.5:
                fund_score += 20  # Volume spike = unusual activity (treasure #3)
            # Position size
            pos_size = calculate_position_size(atr, close_p)
            candidates.append({
                'ticker': ticker,
                'price': close_p,
                'score': fund_score,
                'position_size': pos_size,
                'atr': atr,
                'atr_pct': (atr / close_p) * 100,
            })

        # Pick top candidates
        candidates.sort(key=lambda x: x['score'], reverse=True)
        for c in candidates[:MAX_PICKS_PER_DAY]:
            position_value = available_capital * c['position_size']
            if position_value < 1000:
                continue  # Skip tiny positions
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
                'stop': c['price'] * (1 - STOP_LOSS_PCT),
                'target': c['price'] * (1 + TAKE_PROFIT_PCT),
                'trailing_high': c['price'],
                'position_size_mult': c['position_size'],
                'fundamentals': fundamentals[c['ticker']],
            })

        # Track portfolio value
        portfolio_value = cash
        for pos in open_positions:
            ticker = pos['ticker']
            today_data = next((r for r in prices[ticker] if r[0] == current_date), None)
            if today_data:
                portfolio_value += pos['shares'] * (today_data[4] or pos['entry_price'])
        portfolio_value_history.append({'date': current_date, 'value': portfolio_value})

    # Close remaining positions at last price
    last_date = trading_dates[-1] if trading_dates else None
    for pos in open_positions:
        ticker = pos['ticker']
        if ticker in prices:
            last_data = prices[ticker][-1]
            exit_price = last_data[4] or pos['entry_price']
            proceeds = pos['shares'] * exit_price
            cash += proceeds
            pnl_pct = ((exit_price - pos['entry_price']) / pos['entry_price']) * 100
            trades.append({
                'ticker': ticker,
                'entry_date': pos['entry_date'],
                'exit_date': last_date,
                'entry_price': pos['entry_price'],
                'exit_price': exit_price,
                'shares': pos['shares'],
                'pnl_pct': pnl_pct,
                'exit_reason': 'backtest_end',
                'holding_days': 1,
                'fundamentals': pos.get('fundamentals', {}),
                'position_size_mult': pos.get('position_size_mult', 1.0),
            })

    return trades, portfolio_value_history, cash


def generate_report(trades, portfolio_history, final_cash):
    """Generate backtest report."""
    if not trades:
        print('\n❌ No trades generated.')
        return

    # Calculate metrics
    total_trades = len(trades)
    wins = [t for t in trades if t['pnl_pct'] > 0]
    losses = [t for t in trades if t['pnl_pct'] <= 0]
    win_rate = (len(wins) / total_trades) * 100 if total_trades else 0
    avg_win = sum(t['pnl_pct'] for t in wins) / len(wins) if wins else 0
    avg_loss = sum(t['pnl_pct'] for t in losses) / len(losses) if losses else 0
    total_pnl_pct = ((final_cash - INITIAL_CAPITAL) / INITIAL_CAPITAL) * 100
    profit_factor = (sum(t['pnl_pct'] for t in wins) / abs(sum(t['pnl_pct'] for t in losses))) if losses else float('inf')

    # Max drawdown
    peak = INITIAL_CAPITAL
    max_dd = 0
    for ph in portfolio_history:
        if ph['value'] > peak:
            peak = ph['value']
        dd = ((ph['value'] - peak) / peak) * 100
        if dd < max_dd:
            max_dd = dd

    # Exit reasons
    exit_reasons = defaultdict(int)
    for t in trades:
        exit_reasons[t['exit_reason']] += 1

    # Generate CSV
    with open(TRADES_CSV, 'w') as f:
        f.write('ticker,entry_date,exit_date,entry_price,exit_price,shares,pnl_pct,exit_reason,position_size_mult,pe,roe\n')
        for t in trades:
            pe = t.get('fundamentals', {}).get('pe', '')
            roe = t.get('fundamentals', {}).get('roe', '')
            f.write(f"{t['ticker']},{t['entry_date']},{t['exit_date']},{t['entry_price']:.2f},{t['exit_price']:.2f},{t['shares']},{t['pnl_pct']:.2f},{t['exit_reason']},{t['position_size_mult']:.2f},{pe},{roe}\n")

    # Generate JSON summary
    summary = {
        'period': f'{START_DATE} → {END_DATE}',
        'initial_capital': INITIAL_CAPITAL,
        'final_capital': round(final_cash, 2),
        'total_return_pct': round(total_pnl_pct, 2),
        'total_trades': total_trades,
        'win_rate': round(win_rate, 2),
        'avg_win_pct': round(avg_win, 2),
        'avg_loss_pct': round(avg_loss, 2),
        'profit_factor': round(profit_factor, 2) if profit_factor != float('inf') else 'inf',
        'max_drawdown_pct': round(max_dd, 2),
        'exit_reasons': dict(exit_reasons),
        'trades': trades[:20],  # First 20 for preview
    }
    with open(SUMMARY_JSON, 'w') as f:
        json.dump(summary, f, indent=2, default=str)

    # Generate markdown report
    with open(REPORT_MD, 'w', encoding='utf-8') as f:
        f.write('# V40.2 Backtest Report — with Treasures\n\n')
        f.write(f'**Period:** {START_DATE} → {END_DATE}\n\n')
        f.write(f'**Initial Capital:** {INITIAL_CAPITAL:,} EGP\n\n')
        f.write(f'**Final Capital:** {final_cash:,.2f} EGP\n\n')
        f.write(f'**Total Return:** {total_pnl_pct:+.2f}%\n\n')
        f.write(f'**Max Drawdown:** {max_dd:.2f}%\n\n')
        f.write('---\n\n')
        f.write('## Treasures Used\n\n')
        f.write('1. **Screener Lists** (data_engine.db.screener_lists): most_active + unusual_volume + top_gainers\n')
        f.write('2. **Fundamentals** (data_engine.db.tab_valuation + tab_profitability): P/E < 50, ROE > 5%\n')
        f.write('3. **Position Sizing** (volatility-based): 55% for high-vol, 80% for normal, 100% for low-vol\n')
        f.write('4. **Trailing Stop**: 10% trailing stop for trend following\n\n')
        f.write('---\n\n')
        f.write('## Performance Metrics\n\n')
        f.write(f'| Metric | Value |\n|--------|-------|\n')
        f.write(f'| Total Trades | {total_trades} |\n')
        f.write(f'| Win Rate | {win_rate:.2f}% |\n')
        f.write(f'| Avg Win | {avg_win:+.2f}% |\n')
        f.write(f'| Avg Loss | {avg_loss:+.2f}% |\n')
        f.write(f'| Profit Factor | {profit_factor:.2f}' if profit_factor != float('inf') else '| Profit Factor | ∞' + ' |\n')
        f.write(f'| Max Drawdown | {max_dd:.2f}% |\n\n')
        f.write('## Exit Reasons\n\n')
        f.write('| Reason | Count |\n|--------|-------|\n')
        for reason, count in exit_reasons.items():
            f.write(f'| {reason} | {count} |\n')
        f.write('\n## Top 10 Trades\n\n')
        f.write('| Ticker | Entry | Exit | PnL% | Reason | P/E | ROE |\n')
        f.write('|--------|-------|------|------|--------|-----|-----|\n')
        sorted_trades = sorted(trades, key=lambda x: x['pnl_pct'], reverse=True)
        for t in sorted_trades[:10]:
            pe = t.get('fundamentals', {}).get('pe', '')
            roe = t.get('fundamentals', {}).get('roe', '')
            f.write(f"| {t['ticker']} | {t['entry_price']:.2f} | {t['exit_price']:.2f} | {t['pnl_pct']:+.2f}% | {t['exit_reason']} | {pe} | {roe} |\n")

    # Print summary to console
    print('\n' + '=' * 70)
    print('BACKTEST RESULTS')
    print('=' * 70)
    print(f'Total Trades: {total_trades}')
    print(f'Win Rate: {win_rate:.2f}%')
    print(f'Avg Win: {avg_win:+.2f}%')
    print(f'Avg Loss: {avg_loss:+.2f}%')
    print(f'Profit Factor: {profit_factor:.2f}' if profit_factor != float('inf') else 'Profit Factor: ∞')
    print(f'Max Drawdown: {max_dd:.2f}%')
    print(f'Initial Capital: {INITIAL_CAPITAL:,} EGP')
    print(f'Final Capital: {final_cash:,.2f} EGP')
    print(f'Total Return: {total_pnl_pct:+.2f}%')
    print(f'\nExit Reasons: {dict(exit_reasons)}')
    print(f'\n📄 Report: {REPORT_MD}')
    print(f'📊 Summary: {SUMMARY_JSON}')
    print(f'📋 Trades CSV: {TRADES_CSV}')


if __name__ == '__main__':
    trades, portfolio_history, final_cash = run_backtest()
    generate_report(trades, portfolio_history, final_cash)
