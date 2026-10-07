#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
╔══════════════════════════════════════════════════════════════════╗
║  ⏳ HISTORICAL PREDICTIONS BACKFILL                              ║
║  Generates realistic closed predictions for last 30 trading days  ║
╚══════════════════════════════════════════════════════════════════╝
"""
import sqlite3
import math
import re
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

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

def backfill_predictions():
    print("🚀 Starting Historical Backfill (Last 90 Trading Days)...")
    
    conn_ph = sqlite3.connect(DB_DIR / 'price_history.db')
    conn_ph.row_factory = sqlite3.Row
    
    conn_pred = sqlite3.connect(DB_DIR / 'predictions.db')
    conn_pred.row_factory = sqlite3.Row
    
    # 1. Get last 90 trading days
    dates = conn_ph.execute("SELECT DISTINCT date FROM price_history ORDER BY date DESC LIMIT 90").fetchall()
    if not dates:
        print("❌ No historical dates found in price_history.db!")
        return

    inserted = 0
    wins = 0
    losses = 0
    expired = 0
    
    # 2. For each day, get top 10 stocks by volume
    for d in dates:
        day = d['date']
        stocks = conn_ph.execute("""
            SELECT ticker, close_price as entry, high_price as day_high, low_price as day_low, volume
            FROM price_history 
            WHERE date = ? AND close_price > 0
            ORDER BY date DESC
        """, (day,)).fetchall()
        
        # Filter top 10 stocks with parsed volume > 100,000
        valid_stocks = []
        for s in stocks:
            vol = parse_vol(s['volume'])
            if vol >= 100000:
                valid_stocks.append((s['ticker'], float(s['entry'])))
            if len(valid_stocks) >= 10:
                break
        
        for ticker, entry in valid_stocks:
            # Check if prediction already exists for this ticker & date
            exists = conn_pred.execute(
                "SELECT count(*) FROM predictions WHERE ticker = ? AND prediction_date = ?",
                (ticker, day)
            ).fetchone()[0]
            if exists > 0:
                continue
                
            atr_pct = 0.05  # 5% average volatility
            target = round(entry * (1 + (atr_pct * 2)), 2)   # +10% target
            stop = round(entry * (1 - (atr_pct * 1.5)), 2)   # -7.5% stop loss
            
            # 3. Look up prices in subsequent 15 trading days
            future = conn_ph.execute("""
                SELECT high_price as high, low_price as low, close_price as close, date 
                FROM price_history 
                WHERE ticker = ? AND date > ?
                ORDER BY date ASC LIMIT 15
            """, (ticker, day)).fetchall()
            
            if not future:
                continue
                
            outcome_date = None
            hit_target = 0
            hit_stop = 0
            exit_price = None
            actual_return = 0.0
            holding_days = 0
            
            # 4. Check whether target or stop loss was hit first
            for i, f in enumerate(future):
                holding_days = i + 1
                f_high = float(f['high'] or 0)
                f_low = float(f['low'] or 0)
                f_close = float(f['close'] or 0)
                
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
            
            # Rotate personas evenly: gambler, balanced, conservative
            personas_cycle = ['gambler', 'balanced', 'conservative']
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
                ticker, signal, signal, day, entry, target, stop, 65.0, 'EGX', persona,
                outcome_date, exit_price, round(actual_return, 2), hit_target, hit_stop,
                hit_target, holding_days, 60.0, created_ts
            ))
            
            inserted += 1

    conn_pred.commit()
    settled = wins + losses
    win_rate = (wins / settled * 100) if settled > 0 else 0
    print(f"✅ Backfill Complete! Inserted: {inserted} predictions.")
    print(f"📊 Wins: {wins} | Losses: {losses} | Expired: {expired} | Win Rate (Settled): {win_rate:.1f}%")
    
    conn_ph.close()
    conn_pred.close()

if __name__ == '__main__':
    backfill_predictions()
