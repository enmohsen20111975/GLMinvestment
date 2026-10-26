#!/usr/bin/env python3
"""
HISTORICAL BACKTEST — 4 months, EGX market
============================================
Runs master_analyzer on historical snapshots, NO look-ahead bias.
Records trades, computes weekly results, generates reports.

Rules:
- Signal generated at T using only data available UP TO T
- Entry = next session open (or close if no open available)
- Exit = stop loss hit, target hit, or 7-session holding period
- Commission: 0.1% per trade, Slippage: 0.05%
- Position size: 5% of capital (default), max 25%
- NO look-ahead: prices[0..N] at time T, NOT prices[T..T+7]

Run:
    python3 scripts/run_historical_backtest.py
"""
from __future__ import annotations
import sys, sqlite3, json, os, statistics, warnings
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
warnings.filterwarnings('ignore')

# Config
WINDOW_START = '2026-06-25'
WINDOW_END = '2026-10-25'
MARKET = 'EGX'
COMMISSION_PCT = 0.1
SLIPPAGE_PCT = 0.05
POSITION_SIZE_PCT = 5.0
INITIAL_CAPITAL = 10000.0
MAX_HOLDING = 7  # sessions
SAMPLE_TICKERS = 20  # limit for speed (full run = 463 tickers)

DB_PH = str(PROJECT_ROOT / 'db' / 'price_history.db')
OUTPUT_DIR = PROJECT_ROOT / 'backtest_results'

def get_week_key(date_str):
    """Return YYYY-Www (ISO week)."""
    d = datetime.strptime(date_str, '%Y-%m-%d')
    iso = d.isocalendar()
    return f"{iso[0]}-W{iso[1]:02d}"

def run_backtest():
    print("="*70)
    print(f"HISTORICAL BACKTEST — {MARKET}")
    print(f"Window: {WINDOW_START} to {WINDOW_END}")
    print(f"Sample: {SAMPLE_TICKERS} tickers | Commission: {COMMISSION_PCT}% | Slippage: {SLIPPAGE_PCT}%")
    print("="*70)

    # Get tickers
    c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute(f"SELECT DISTINCT ticker FROM price_history WHERE market='{MARKET}' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' AND close_price>0 ORDER BY ticker LIMIT {SAMPLE_TICKERS}")
    tickers = [r[0] for r in cur.fetchall()]
    c.close()
    print(f"Testing {len(tickers)} tickers: {tickers[:5]}...")

    # Get all dates in window for this market
    c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
    cur = c.cursor()
    cur.execute(f"SELECT DISTINCT date FROM price_history WHERE market='{MARKET}' AND date BETWEEN '{WINDOW_START}' AND '{WINDOW_END}' ORDER BY date")
    all_dates = [r[0] for r in cur.fetchall()]
    c.close()
    print(f"Trading dates: {len(all_dates)}")

    trades = []
    capital = INITIAL_CAPITAL
    capital_curve = [(WINDOW_START, capital)]
    
    from analyzers.master_analyzer import MasterAnalyzer
    analyzer = MasterAnalyzer()

    for i, signal_date in enumerate(all_dates):
        if i < 60:  # need 60 sessions history minimum
            continue
        if i % 20 == 0:
            print(f"  Progress: {i}/{len(all_dates)} dates, {len(trades)} trades so far")

        for ticker in tickers:
            # Get prices UP TO signal_date (no look-ahead!)
            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            cur.execute(f"SELECT date, open_price, high_price, low_price, close_price, volume FROM price_history WHERE ticker=? AND market='{MARKET}' AND date<=? AND close_price>0 ORDER BY date DESC LIMIT 60", (ticker, signal_date))
            rows = cur.fetchall()[::-1]  # oldest→newest
            c.close()

            if len(rows) < 50:
                continue

            prices = [r[4] for r in rows]  # close_price
            volumes = [r[5] for r in rows if r[5]]

            if len(prices) < 50:
                continue

            # Run analysis (NO look-ahead — only data up to signal_date)
            try:
                result = analyzer.analyze(ticker, prices=prices, volumes=volumes)
            except Exception:
                continue

            if not result:
                continue

            signal = getattr(result, 'signal', 'HOLD')
            score = getattr(result, 'master_score', 0)
            rp = getattr(result, 'risk_profile', {})

            if signal not in ('STRONG_BUY', 'BUY', 'ACCUMULATE'):
                continue

            entry = prices[-1]  # entry at last close (conservative — no look-ahead)
            if isinstance(rp, dict):
                stop = rp.get('stop_loss', entry * 0.95)
                target = rp.get('target_price', entry * 1.10)
            else:
                stop = entry * 0.95
                target = entry * 1.10

            # Get future prices for outcome (look at next 7 sessions)
            future_idx = all_dates.index(signal_date) if signal_date in all_dates else i
            future_dates = all_dates[future_idx+1:future_idx+1+MAX_HOLDING]
            
            c = sqlite3.connect(f'file:{DB_PH}?mode=ro', uri=True)
            cur = c.cursor()
            placeholders = ','.join('?' * len(future_dates)) if future_dates else 'NULL'
            if future_dates:
                cur.execute(f"SELECT date, high_price, low_price, close_price FROM price_history WHERE ticker=? AND market='{MARKET}' AND date IN ({placeholders}) ORDER BY date", (ticker, *future_dates))
                future_rows = cur.fetchall()
            else:
                future_rows = []
            c.close()

            if not future_rows:
                continue

            # Simulate trade
            exit_price = None
            exit_reason = ''
            exit_date = ''

            for fr in future_rows:
                f_date, f_high, f_low, f_close = fr
                if f_low and stop and f_low <= stop:
                    exit_price = stop
                    exit_reason = 'STOP_LOSS'
                    exit_date = f_date
                    break
                if f_high and target and f_high >= target:
                    exit_price = target
                    exit_reason = 'TARGET_HIT'
                    exit_date = f_date
                    break
                exit_price = f_close
                exit_reason = 'HOLDING_EXPIRED'
                exit_date = f_date

            if not exit_price:
                continue

            # Calculate P&L
            gross_return = (exit_price - entry) / entry * 100
            costs = COMMISSION_PCT * 2 + SLIPPAGE_PCT * 2
            net_return = gross_return - costs
            position_value = capital * (POSITION_SIZE_PCT / 100)
            pnl = position_value * (net_return / 100)
            capital += pnl

            trade = {
                'signal_date': signal_date,
                'week': get_week_key(signal_date),
                'market': MARKET,
                'ticker': ticker,
                'signal': signal,
                'master_score': round(score, 2),
                'entry_price': round(entry, 4),
                'stop_loss': round(stop, 4),
                'target_price': round(target, 4),
                'exit_date': exit_date,
                'exit_price': round(exit_price, 4),
                'exit_reason': exit_reason,
                'holding_days': len(future_rows[:future_rows.index(next(f for f in future_rows if f[0]==exit_date)) + 1]) if exit_date in [f[0] for f in future_rows] else 0,
                'gross_return_pct': round(gross_return, 4),
                'net_return_pct': round(net_return, 4),
                'pnl_egp': round(pnl, 2),
                'capital_after': round(capital, 2),
                'commission_pct': COMMISSION_PCT,
                'slippage_pct': SLIPPAGE_PCT,
            }
            trades.append(trade)
            capital_curve.append((exit_date, capital))

    # === Results ===
    print(f"\n{'='*70}")
    print(f"BACKTEST RESULTS — {MARKET}")
    print(f"{'='*70}")
    print(f"Total trades: {len(trades)}")
    if not trades:
        print("No trades generated. Check signal thresholds or data.")
        return

    wins = [t for t in trades if t['net_return_pct'] > 0.5]
    losses = [t for t in trades if t['net_return_pct'] < -0.5]
    neutrals = [t for t in trades if -0.5 <= t['net_return_pct'] <= 0.5]

    print(f"Wins: {len(wins)} | Losses: {len(losses)} | Neutral: {len(neutrals)}")
    wr = len(wins)/len(trades)*100 if trades else 0
    print(f"Win Rate: {wr:.1f}%")
    
    total_pnl = sum(t['pnl_egp'] for t in trades)
    total_profit = sum(t['pnl_egp'] for t in wins)
    total_loss = abs(sum(t['pnl_egp'] for t in losses))
    pf = total_profit / total_loss if total_loss > 0 else float('inf')
    
    print(f"Total P&L: {total_pnl:+.2f} EGP")
    print(f"Gross Profit: {total_profit:+.2f} | Gross Loss: {total_loss:+.2f}")
    print(f"Profit Factor: {pf:.2f}" if pf != float('inf') else "Profit Factor: ∞")
    print(f"Net Return: {(capital-INITIAL_CAPITAL)/INITIAL_CAPITAL*100:+.2f}%")
    
    avg_win = statistics.mean([t['net_return_pct'] for t in wins]) if wins else 0
    avg_loss = statistics.mean([t['net_return_pct'] for t in losses]) if losses else 0
    print(f"Avg Win: {avg_win:+.2f}% | Avg Loss: {avg_loss:+.2f}%")
    
    # Max drawdown
    peak = INITIAL_CAPITAL
    max_dd = 0
    for _, cap in capital_curve:
        if cap > peak: peak = cap
        dd = (peak - cap) / peak * 100
        if dd > max_dd: max_dd = dd
    print(f"Max Drawdown: {max_dd:.2f}%")

    # Weekly results
    weekly = {}
    for t in trades:
        wk = t['week']
        if wk not in weekly: weekly[wk] = {'trades':0,'wins':0,'losses':0,'pnl':0}
        weekly[wk]['trades'] += 1
        if t['net_return_pct'] > 0.5: weekly[wk]['wins'] += 1
        elif t['net_return_pct'] < -0.5: weekly[wk]['losses'] += 1
        weekly[wk]['pnl'] += t['pnl_egp']

    print(f"\n{'='*70}")
    print("WEEKLY RESULTS")
    print(f"{'='*70}")
    print(f"{'Week':<12} {'Trades':>7} {'Wins':>5} {'Losses':>7} {'WR%':>6} {'P&L':>10}")
    print("-"*50)
    for wk in sorted(weekly.keys()):
        d = weekly[wk]
        wr = d['wins']/d['trades']*100 if d['trades'] else 0
        print(f"{wk:<12} {d['trades']:>7} {d['wins']:>5} {d['losses']:>7} {wr:>5.1f}% {d['pnl']:>+9.2f}")

    # Write outputs
    os.makedirs(OUTPUT_DIR, exist_ok=True)
    os.makedirs(OUTPUT_DIR / 'weekly_results', exist_ok=True)
    
    # Trade ledger CSV
    import csv
    with open(OUTPUT_DIR / 'trade_ledger.csv', 'w', newline='') as f:
        w = csv.DictWriter(f, fieldnames=list(trades[0].keys()))
        w.writeheader()
        for t in trades: w.writerow(t)
    
    # Market summary CSV
    with open(OUTPUT_DIR / 'market_summary.csv', 'w', newline='') as f:
        w = csv.writer(f)
        w.writerow(['week','market','trades','wins','losses','wr_pct','pnl_egp','capital_end'])
        cap = INITIAL_CAPITAL
        for wk in sorted(weekly.keys()):
            d = weekly[wk]
            cap += d['pnl']
            wr = d['wins']/d['trades']*100 if d['trades'] else 0
            w.writerow([wk, MARKET, d['trades'], d['wins'], d['losses'], f'{wr:.1f}', f'{d["pnl"]:.2f}', f'{cap:.2f}'])
    
    # Weekly reports
    for wk, d in weekly.items():
        with open(OUTPUT_DIR / 'weekly_results' / f'{wk}_{MARKET}.md', 'w') as f:
            wr = d['wins']/d['trades']*100 if d['trades'] else 0
            f.write(f"# Week {wk} — {MARKET}\n\n")
            f.write(f"- Trades: {d['trades']}\n- Wins: {d['wins']}\n- Losses: {d['losses']}\n")
            f.write(f"- Win Rate: {wr:.1f}%\n- P&L: {d['pnl']:+.2f} EGP\n")

    print(f"\nOutputs: backtest_results/")
    print(f"  trade_ledger.csv ({len(trades)} trades)")
    print(f"  market_summary.csv ({len(weekly)} weeks)")
    print(f"  weekly_results/ ({len(weekly)} files)")

if __name__ == '__main__':
    run_backtest()
