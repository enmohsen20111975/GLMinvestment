"""Backtest engine — runs pipeline on data + calculates metrics."""
import sqlite3
from .config import DB_DIR, TRAIN_START, TRAIN_END, TEST_START, TEST_END, TARGET_PCT, STOP_PCT, HOLDING_DAYS
from .metrics import calc_metrics

def run_backtest(data, pipeline_fn, start_date, end_date):
    """Run pipeline on data, return trades + metrics."""
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    trades = []
    
    for ticker, candles in data.items():
        for i in range(50, len(candles)):
            day = candles[i]
            if day['date'] < start_date or day['date'] > end_date:
                continue
            
            # Run pipeline
            result = pipeline_fn(candles, i, ticker)
            if result is None:
                continue
            
            entry, target, stop = result
            
            # Find exit
            exit_price = None
            outcome = 'EXPIRED'
            for j in range(i+1, min(i+1+HOLDING_DAYS, len(candles))):
                if candles[j]['low'] is not None and candles[j]['low'] <= stop:
                    exit_price = stop; outcome = 'STOPPED'; break
                if candles[j]['high'] is not None and candles[j]['high'] >= target:
                    exit_price = target; outcome = 'TARGET_HIT'; break
            
            if exit_price is None:
                exit_price = candles[min(i+HOLDING_DAYS, len(candles)-1)]['close']
            
            return_pct = (exit_price / entry - 1) * 100
            trades.append({
                'date': day['date'], 'ticker': ticker,
                'entry': entry, 'exit': exit_price,
                'return_pct': round(return_pct, 2),
                'outcome': outcome,
            })
    
    conn.close()
    metrics = calc_metrics(trades)
    return trades, metrics
