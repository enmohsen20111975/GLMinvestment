#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
========================================================================
  📊 REAL MAESTRO 8-LAYER HISTORICAL ACCURACY REPORT
  Evaluates the exact 8-Layer Maestro Engine on real price candles
  across 90 days, 30 days, and 7 days.
========================================================================
"""
import sqlite3
import math
import re
from datetime import datetime, timedelta
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

from backtest_unified_pipeline import analyze_as_of

def parse_vol(v):
    if not v: return 0.0
    try:
        s = str(v).replace(',', '').strip()
        if 'M' in s: return float(re.sub(r'[^\d.]', '', s)) * 1_000_000
        if 'K' in s: return float(re.sub(r'[^\d.]', '', s)) * 1_000
        if 'B' in s: return float(re.sub(r'[^\d.]', '', s)) * 1_000_000_000
        n = float(re.sub(r'[^\d.]', '', s))
        return n if n > 0 else 0.0
    except: return 0.0

def load_history_direct(ticker):
    conn = sqlite3.connect(DB_DIR / 'price_history.db')
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("""
        SELECT date, open_price AS open, high_price AS high,
               low_price AS low, close_price AS close, volume
        FROM price_history
        WHERE ticker = ? AND close_price > 0
        ORDER BY date ASC
    """, (ticker,))
    rows = [dict(r) for r in cur.fetchall()]
    conn.close()
    return rows

def evaluate_maestro_history():
    conn_ph = sqlite3.connect(DB_DIR / 'price_history.db')
    conn_ph.row_factory = sqlite3.Row
    
    # Top 50 liquid EGX tickers
    top_tickers = [r[0] for r in conn_ph.execute("""
        SELECT ticker, sum(cast(volume as float)) as v 
        FROM price_history 
        GROUP BY ticker 
        ORDER BY v DESC LIMIT 50
    """).fetchall()]
    
    # Sector map
    conn_s = sqlite3.connect(DB_DIR / 'stocks.db')
    conn_s.row_factory = sqlite3.Row
    stock_sectors = {r['ticker']: (r['sector'] or 'Finance') for r in conn_s.execute("SELECT ticker, sector FROM stocks").fetchall()}
    conn_s.close()

    histories = {}
    for t in top_tickers:
        h = load_history_direct(t)
        if len(h) >= 60:
            histories[t] = h
            
    conn_ph.close()

    now = datetime.now()
    cutoff_90 = (now - timedelta(days=90)).strftime('%Y-%m-%d')
    cutoff_30 = (now - timedelta(days=30)).strftime('%Y-%m-%d')
    cutoff_7  = (now - timedelta(days=7)).strftime('%Y-%m-%d')

    timeframe_stats = {
        '90_days': {'cutoff': cutoff_90, 'buy_signals': 0, 'wins': 0, 'losses': 0, 'expired': 0, 'gross_win': 0.0, 'gross_loss': 0.0},
        '30_days': {'cutoff': cutoff_30, 'buy_signals': 0, 'wins': 0, 'losses': 0, 'expired': 0, 'gross_win': 0.0, 'gross_loss': 0.0},
        '7_days':  {'cutoff': cutoff_7,  'buy_signals': 0, 'wins': 0, 'losses': 0, 'expired': 0, 'gross_win': 0.0, 'gross_loss': 0.0},
    }

    for ticker, full_h in histories.items():
        sector = stock_sectors.get(ticker, 'Finance')
        
        # Loop through candles from index 60 onwards
        for i in range(60, len(full_h)):
            slice_h = full_h[: i + 1]
            as_of_date = slice_h[-1]['date']
            
            # Check which time windows this date falls into
            active_windows = []
            if as_of_date >= cutoff_90: active_windows.append('90_days')
            if as_of_date >= cutoff_30: active_windows.append('30_days')
            if as_of_date >= cutoff_7:  active_windows.append('7_days')
            
            if not active_windows:
                continue
                
            analysis = analyze_as_of(slice_h, sector=sector)
            if not analysis or analysis.get('signal') != 'BUY':
                continue
                
            entry = analysis['entry']
            target = analysis['target']
            stop = analysis['stop_loss']
            
            # Evaluate outcome over next 15 candles
            future = full_h[i + 1 : i + 16]
            outcome = 'expired'
            ret_pct = 0.0
            
            if future:
                for f in future:
                    f_high = float(f['high'] or 0)
                    f_low = float(f['low'] or 0)
                    
                    if f_high >= target:
                        outcome = 'win'
                        ret_pct = ((target - entry) / entry) * 100
                        break
                    elif f_low > 0 and f_low <= stop:
                        outcome = 'loss'
                        ret_pct = ((stop - entry) / entry) * 100
                        break
                if outcome == 'expired':
                    ret_pct = ((float(future[-1]['close'] or entry) - entry) / entry) * 100

            # Record stats across all matching windows
            for w in active_windows:
                st = timeframe_stats[w]
                st['buy_signals'] += 1
                if outcome == 'win':
                    st['wins'] += 1
                    st['gross_win'] += ret_pct
                elif outcome == 'loss':
                    st['losses'] += 1
                    st['gross_loss'] += abs(ret_pct)
                else:
                    st['expired'] += 1

    print("\n========================================================================")
    print(" 📊 REAL MAESTRO 8-LAYER ENGINE — ACCURACY REPORT BY TIMEFRAME")
    print("========================================================================")
    for w_name, st in timeframe_stats.items():
        wins = st['wins']
        losses = st['losses']
        settled = wins + losses
        wr = (wins / settled * 100) if settled > 0 else 0.0
        avg_win = (st['gross_win'] / wins) if wins > 0 else 0.0
        avg_loss = (st['gross_loss'] / losses) if losses > 0 else 0.0
        pf = (st['gross_win'] / st['gross_loss']) if st['gross_loss'] > 0 else 0.0
        
        print(f"\n🗓️ timeframe: {w_name.upper()} (Cutoff >= {st['cutoff']})")
        print(f"   • Total BUY Signals Generated: {st['buy_signals']}")
        print(f"   • Settled Trades: {settled}  |  Wins: {wins}  |  Losses: {losses}  |  Pending/Expired: {st['expired']}")
        print(f"   🎯 REAL WIN RATE: {wr:.2f}%")
        print(f"   📈 Avg Win Return: +{avg_win:.2f}%  |  Avg Loss: -{avg_loss:.2f}%")
        print(f"   ⚡ Profit Factor: {pf:.2f}")

if __name__ == '__main__':
    evaluate_maestro_history()
