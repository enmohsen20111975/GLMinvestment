import sqlite3
import json
from pathlib import Path

def generate_report():
    print("=" * 60)
    print("📊 QUICK PERFORMANCE REPORT (Historical Predictions) 📊")
    print("=" * 60)
    
    pred_db = '/home/meme/my_apps/GLMinvestment/db/predictions.db'
    prices_db = '/home/meme/my_apps/GLMinvestment/db/price_history.db'
    
    conn_p = sqlite3.connect(pred_db)
    conn_p.row_factory = sqlite3.Row
    
    conn_h = sqlite3.connect(prices_db)
    conn_h.row_factory = sqlite3.Row
    
    try:
        predictions = conn_p.execute('''
            SELECT ticker, prediction_date, signal as recommendation, entry_price, target_price, stop_loss
            FROM predictions
            WHERE signal = 'BUY'
            AND entry_price > 0 AND target_price > 0 AND stop_loss > 0
        ''').fetchall()
    except Exception as e:
        print(f"Error reading predictions: {e}")
        return
        
    print(f"Total Buy Signals Found: {len(predictions)}")
    if not predictions:
        print("No buy signals found. Please ensure backfill has completed.")
        return
        
    wins = 0
    losses = 0
    pending = 0
    total_profit_pct = 0.0
    
    for p in predictions:
        ticker = p['ticker']
        pred_date = p['prediction_date'].split(' ')[0] # Get YYYY-MM-DD
        
        # Get prices AFTER the prediction date
        future_prices = conn_h.execute('''
            SELECT date, high_price, low_price, close_price 
            FROM price_history 
            WHERE ticker = ? AND date > ? 
            ORDER BY date ASC LIMIT 30
        ''', (ticker, pred_date)).fetchall()
        
        if not future_prices:
            pending += 1
            continue
            
        entry = p['entry_price']
        target = p['target_price']
        stop = p['stop_loss']
        
        outcome = 'pending'
        for fp in future_prices:
            high = fp['high_price']
            low = fp['low_price']
            
            # Did it hit target first?
            if high >= target:
                wins += 1
                profit = ((target - entry) / entry) * 100
                total_profit_pct += profit
                outcome = 'win'
                break
                
            # Did it hit stop loss first?
            if low <= stop:
                losses += 1
                loss = ((stop - entry) / entry) * 100
                total_profit_pct += loss
                outcome = 'loss'
                break
                
        if outcome == 'pending':
            # Calculate floating profit/loss based on last available close
            last_close = future_prices[-1]['close_price']
            floating = ((last_close - entry) / entry) * 100
            total_profit_pct += floating
            pending += 1

    total_closed = wins + losses
    win_rate = (wins / total_closed * 100) if total_closed > 0 else 0
    
    print("\n--- RESULTS ---")
    print(f"✅ Winning Trades (Hit Target): {wins}")
    print(f"❌ Losing Trades (Hit Stop Loss): {losses}")
    print(f"⏳ Pending Trades (Open): {pending}")
    print("-" * 30)
    print(f"🎯 Win Rate (Closed Trades): {win_rate:.1f}%")
    print(f"💰 Total Profit/Loss: {total_profit_pct:.1f}%")
    print("=" * 60)
    
if __name__ == '__main__':
    generate_report()
