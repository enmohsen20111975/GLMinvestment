#!/usr/bin/env python3
"""
Run Persona Analysis for TADAWUL
Populates persona_predictions in predictions.db for all active TADAWUL stocks.
"""
import sys
import os
import sqlite3
from pathlib import Path
from datetime import datetime

BASE_DIR = Path(__file__).parent.parent.resolve()
sys.path.insert(0, str(BASE_DIR / "vps-service"))

from analyzers.persona_gambler import analyze_gambler
from analyzers.persona_investor import analyze_investor
from core.persona_db import safe_store_prediction

def main():
    stocks_db = str(BASE_DIR / "db" / "stocks.db")
    pred_db = str(BASE_DIR / "db" / "predictions.db")
    
    conn = sqlite3.connect(stocks_db)
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()
    cur.execute("SELECT * FROM stocks WHERE market='TADAWUL' AND is_active=1")
    stocks = [dict(r) for r in cur.fetchall()]
    conn.close()
    
    print(f"Found {len(stocks)} active TADAWUL stocks.")
    today = datetime.now().strftime('%Y-%m-%d')
    
    stored_gambler = 0
    stored_investor = 0
    
    for s in stocks:
        ticker = s['ticker']
        curr_price = float(s.get('current_price') or 0)
        if curr_price <= 0:
            continue
            
        context = {"market": "TADAWUL", "screener_most_active": False}
        
        try:
            g_res = analyze_gambler(ticker, s, context)
            if g_res and g_res.signal:
                ok = safe_store_prediction(
                    ticker=ticker,
                    market='TADAWUL',
                    persona_type='gambler',
                    signal_type=g_res.signal,
                    entry_price=g_res.entry or curr_price,
                    target_price=g_res.target,
                    stop_loss=g_res.stop,
                    prediction_date=today
                )
                if ok:
                    stored_gambler += 1
        except Exception as e:
            print(f"Error analyzing gambler for {ticker}: {e}")
            
        try:
            i_res = analyze_investor(ticker, s, context)
            if i_res and i_res.signal:
                ok = safe_store_prediction(
                    ticker=ticker,
                    market='TADAWUL',
                    persona_type='investor',
                    signal_type=i_res.signal,
                    entry_price=i_res.entry or curr_price,
                    target_price=i_res.target,
                    stop_loss=i_res.stop,
                    prediction_date=today
                )
                if ok:
                    stored_investor += 1
        except Exception as e:
            print(f"Error analyzing investor for {ticker}: {e}")
            
    print(f"\nDone! Stored {stored_gambler} gambler predictions and {stored_investor} investor predictions for TADAWUL.")

if __name__ == "__main__":
    main()
