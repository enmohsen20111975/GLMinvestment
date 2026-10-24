#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
========================================================================
  🧠 MAESTRO 8-LAYER HISTORICAL PREDICTIONS BACKFILL (FAST & HIGH-WIN)
  Generates historical predictions using the ACTUAL Maestro Engine
========================================================================
"""
import sqlite3
import math
import re
from datetime import datetime
from pathlib import Path
import sys

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'
sys.path.insert(0, str(PROJECT_ROOT / 'scripts'))

from backtest_unified_pipeline import analyze_as_of

def parse_vol(v):
    if not v:
        return 100000.0
    try:
        s = str(v).replace(',', '').strip()
        if 'M' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000_000
        if 'K' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000
        if 'B' in s:
            return float(re.sub(r'[^\d.]', '', s)) * 1_000_000_000
        n = float(re.sub(r'[^\d.]', '', s))
        return n if n > 0 else 100000.0
    except Exception:
        return 100000.0

def load_history_for_ticker(ticker):
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

def backfill_maestro_predictions():
    print("🚀 Starting Maestro 8-Layer Historical Backfill (Top Liquid EGX Stocks)...")
    
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_ph = db_manager.connection(DB_DIR / 'price_history.db', writable=False).__enter__()
    conn_ph.row_factory = sqlite3.Row
    
    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    conn_pred = db_manager.connection(DB_DIR / 'predictions.db', writable=True).__enter__()
    conn_pred.row_factory = sqlite3.Row
    
    conn_pred.execute("DELETE FROM predictions")
    conn_pred.commit()

    # Load top 40 tickers by volume
    top_ticker_rows = conn_ph.execute("""
        SELECT ticker, sum(cast(volume as float)) as total_vol 
        FROM price_history 
        GROUP BY ticker 
        ORDER BY total_vol DESC 
        LIMIT 40
    """).fetchall()
    
    all_tickers = [r['ticker'] for r in top_ticker_rows]
    
    # Sector map
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_s = db_manager.connection(DB_DIR / 'stocks.db', writable=False).__enter__()
    conn_s.row_factory = sqlite3.Row
    stock_sectors = {r['ticker']: (r['sector'] or 'Finance') for r in conn_s.execute("SELECT ticker, sector FROM stocks").fetchall()}
    conn_s.close()
    
    ticker_histories = {}
    for t in all_tickers:
        h = load_history_for_ticker(t)
        if len(h) >= 60:
            ticker_histories[t] = h
            
    conn_ph.close()

    inserted = 0
    wins = 0
    losses = 0
    expired = 0
    
    personas_cycle = ['gambler', 'balanced', 'conservative']

    # Sample dates every 3 trading days for even spread over 90 days
    dates_rows = conn_ph.execute("SELECT DISTINCT date FROM price_history ORDER BY date DESC LIMIT 90").fetchall() if False else []
    
    # We collect candidate dates from COMI history
    comi_h = ticker_histories.get('COMI', list(ticker_histories.values())[0])
    sample_dates = [c['date'] for c in comi_h[-75:]]
    
    for day in sample_dates:
        for ticker, full_h in ticker_histories.items():
            indices = [i for i, candle in enumerate(full_h) if candle['date'] == day]
            if not indices:
                continue
            idx = indices[0]
            if idx < 60:
                continue
                
            history_slice = full_h[: idx + 1]
            sector = stock_sectors.get(ticker, 'Finance')
            
            an = analyze_as_of(history_slice, sector=sector)
            if not an or an.get('signal') != 'BUY':
                continue
                
            score = an['confluence_score']
            if score < 68: # Strict Maestro Buy Threshold
                continue
                
            entry = an['entry']
            target = an['target']
            stop = an['stop_loss']
            
            future = full_h[idx + 1 : idx + 16]
            if not future:
                continue
                
            outcome_date = None
            hit_target = 0
            hit_stop = 0
            exit_price = None
            actual_return = 0.0
            holding_days = 0
            
            for i, f in enumerate(future):
                holding_days = i + 1
                f_high = float(f['high'] or 0)
                f_low = float(f['low'] or 0)
                
                if f_high >= target:
                    hit_target = 1
                    exit_price = target
                    actual_return = ((target - entry) / entry) * 100
                    outcome_date = f['date']
                    break
                elif f_low > 0 and f_low <= stop:
                    hit_stop = 1
                    exit_price = stop
                    actual_return = ((stop - entry) / entry) * 100
                    outcome_date = f['date']
                    break
            
            if hit_target == 0 and hit_stop == 0:
                outcome_date = future[-1]['date']
                exit_price = float(future[-1]['close'] or entry)
                actual_return = ((exit_price - entry) / entry) * 100
                expired += 1
            elif hit_target == 1:
                wins += 1
            elif hit_stop == 1:
                losses += 1

            persona = personas_cycle[inserted % 3]
            signal = 'BUY'
            created_ts = f"{day} 09:00:00"
            
            conn_pred.execute("""
                INSERT INTO predictions (
                    ticker, signal, signal_type, prediction_date, entry_price, 
                    target_price, stop_loss, master_score, market, persona,
                    outcome_date, exit_price, actual_return, hit_target, hit_stop, 
                    is_correct, holding_days, confidence, created_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                ticker, signal, signal, day, entry, target, stop, float(score), 'EGX', persona,
                outcome_date, exit_price, round(actual_return, 2), hit_target, hit_stop,
                hit_target, holding_days, min(95.0, score * 1.1), created_ts
            ))
            
            inserted += 1

    conn_pred.commit()
    settled = wins + losses
    win_rate = (wins / settled * 100) if settled > 0 else 0
    print(f"✅ Fast Maestro Backfill Complete! Inserted: {inserted} predictions.")
    print(f"📊 Wins: {wins} | Losses: {losses} | Expired: {expired} | Win Rate (Settled): {win_rate:.1f}%")
    
    conn_pred.close()

if __name__ == '__main__':
    backfill_maestro_predictions()
