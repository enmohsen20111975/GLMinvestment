#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
========================================================================
  👑 REAL MAESTRO 8-LAYER ENGINE — HISTORICAL CLOSED & LIVE PENDING POPULATOR
  ----------------------------------------------------------------------
  1. Runs the REAL 8-Layer Maestro Engine on historical candles (last 90 days)
  2. Verifies exact outcomes against real subsequent price candles in price_history.db:
     - Target Hit -> exit_type='target_hit', outcome_date=date, is_correct=1
     - Stop Hit   -> exit_type='stop_loss', outcome_date=date, is_correct=0
     - Still Open -> outcome_date=NULL (PENDING trade)
  3. Populates predictions.db with 100% REAL empirical data from the Maestro Engine!
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
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(DB_DIR / 'price_history.db', writable=False).__enter__()
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

def populate_maestro_real_history():
    print("🚀 Starting REAL Maestro 8-Layer Historical Populator (Last 90 Days)...")
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection(DB_DIR / 'price_history.db', writable=False).__enter__()
    conn_ph.row_factory = sqlite3.Row
    
    # Load genuine EGX tickers from stocks.db
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_s = db_manager.connection(DB_DIR / 'stocks.db', writable=False).__enter__()
    conn_s.row_factory = sqlite3.Row
    egx_rows = conn_s.execute("SELECT ticker, sector FROM stocks WHERE (market = 'EGX' OR market IS NULL OR market = '')").fetchall()
    stock_sectors = {r['ticker']: (r['sector'] or 'Finance') for r in egx_rows}
    egx_ticker_set = set(stock_sectors.keys())
    conn_s.close()
    
    # Filter top 50 liquid genuine EGX tickers present in price_history.db
    ph_tickers_raw = [r[0] for r in conn_ph.execute("""
        SELECT ticker, sum(cast(volume as float)) as v 
        FROM price_history 
        GROUP BY ticker 
        ORDER BY v DESC
    """).fetchall()]
    
    top_tickers = [t for t in ph_tickers_raw if t in egx_ticker_set][:50]
    print(f"📊 Filtered {len(top_tickers)} genuine EGX tickers (e.g. {top_tickers[:5]})...")

    histories = {}
    for t in top_tickers:
        h = load_history_direct(t)
        if len(h) >= 60:
            histories[t] = h
            
    conn_ph.close()

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_pred = db_manager.connection(DB_DIR / 'predictions.db', writable=True).__enter__()
    conn_pred.execute("DELETE FROM predictions")
    conn_pred.execute("DELETE FROM stored_analyses")
    conn_pred.commit()

    now = datetime.now()
    cutoff_90 = (now - timedelta(days=90)).strftime('%Y-%m-%d')

    inserted = 0
    closed_wins = 0
    closed_losses = 0
    pending_cnt = 0
    
    personas_cycle = ['gambler', 'balanced', 'conservative']

    for ticker, full_h in histories.items():
        sector = stock_sectors.get(ticker, 'Finance')
        
        # Step through candles from index 60 onwards
        for i in range(60, len(full_h)):
            slice_h = full_h[: i + 1]
            pred_date = slice_h[-1]['date']
            
            if pred_date < cutoff_90:
                continue
                
            analysis = analyze_as_of(slice_h, sector=sector)
            if not analysis or analysis.get('signal') != 'BUY':
                continue
                
            score = float(analysis.get('confluence_score', 0))
            if score < 68: # Maestro Strict Buy Threshold
                continue
                
            entry = float(analysis['entry'])
            target = float(analysis['target'])
            stop = float(analysis['stop_loss'])
            
            future = full_h[i + 1 :]
            
            outcome_date = None
            exit_type = None
            actual_exit_price = None
            actual_return = 0.0
            hit_target = 0
            hit_stop = 0
            is_correct = None
            holding_days = 0
            
            # Evaluate against real future candles
            for idx_f, f in enumerate(future):
                holding_days = idx_f + 1
                f_high = float(f['high'] or 0)
                f_low = float(f['low'] or 0)
                f_date = f['date']
                
                if f_high >= target:
                    hit_target = 1
                    exit_type = 'target_hit'
                    actual_exit_price = target
                    actual_return = round(((target - entry) / entry) * 100, 2)
                    outcome_date = f_date
                    is_correct = 1
                    closed_wins += 1
                    break
                elif f_low > 0 and f_low <= stop:
                    hit_stop = 1
                    exit_type = 'stop_loss'
                    actual_exit_price = stop
                    actual_return = round(((stop - entry) / entry) * 100, 2)
                    outcome_date = f_date
                    is_correct = 0
                    closed_losses += 1
                    break

            if outcome_date is None:
                # Still open (PENDING)
                pending_cnt += 1
                exit_type = None
                is_correct = None
                actual_return = round(((float(slice_h[-1]['close']) - entry) / entry) * 100, 2)

            persona = personas_cycle[inserted % 3]
            created_ts = f"{pred_date} 09:00:00"
            
            conn_pred.execute("""
                INSERT INTO predictions (
                    ticker, signal, signal_type, prediction_date, entry_price, 
                    target_price, stop_loss, master_score, market, persona,
                    outcome_date, exit_price, actual_exit_price, actual_return, 
                    hit_target, hit_stop, is_correct, exit_type, holding_days, 
                    confidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ticker, 'BUY', 'BUY', pred_date, entry, target, stop, score, 'EGX', persona,
                outcome_date, actual_exit_price, actual_exit_price, actual_return,
                hit_target, hit_stop, is_correct, exit_type, holding_days,
                min(95.0, score * 1.1), created_ts
            ))
            
            inserted += 1

    conn_pred.commit()
    settled = closed_wins + closed_losses
    win_rate = (closed_wins / settled * 100) if settled > 0 else 0.0
    
    print("\n========================================================================")
    print(" 👑 REAL MAESTRO 8-LAYER ENGINE — HISTORICAL POPULATION COMPLETE")
    print("========================================================================")
    print(f"  • Total Predictions Inserted: {inserted}")
    print(f"  • Closed Settled Trades: {settled} (Wins: {closed_wins} | Losses: {closed_losses})")
    print(f"  • Live Pending Trades: {pending_cnt}")
    print(f"  🎯 REAL WIN RATE: {win_rate:.2f}%")
    print("========================================================================\n")
    
    conn_pred.close()

if __name__ == '__main__':
    populate_maestro_real_history()
