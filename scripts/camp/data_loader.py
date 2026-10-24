"""Data loader — loads price data + indicators once."""
import sqlite3
from .config import DB_DIR, MAX_TICKERS, TRAIN_START, TEST_END

def load_data():
    """Load price data for top tickers by turnover."""
    conn = sqlite3.connect(str(DB_DIR / 'price_history.db'), timeout=30.0)
    
    tickers = [r[0] for r in conn.execute("""
        SELECT DISTINCT ticker FROM price_history
        WHERE date >= '2025-09-01' AND date <= ?
        AND ticker NOT LIKE '%.%'
        ORDER BY ticker LIMIT ?
    """, (TEST_END, MAX_TICKERS)).fetchall()]
    
    data = {}
    for ticker in tickers:
        rows = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND date >= '2025-09-01' AND date <= ?
            AND close_price > 0
            ORDER BY date
        """, (ticker, TEST_END)).fetchall()
        if len(rows) >= 50:
            data[ticker] = [
                {'date': r[0], 'open': r[1], 'high': r[2], 'low': r[3], 'close': r[4], 'volume': r[5]}
                for r in rows
            ]
            # Compute indicators
            closes = [c['close'] for c in data[ticker]]
            vols = [c['volume'] for c in data[ticker]]
            for i, c in enumerate(data[ticker]):
                c['sma50'] = sum(closes[max(0,i-49):i+1])/min(50,i+1) if i >= 49 else None
                c['sma20'] = sum(closes[max(0,i-19):i+1])/min(20,i+1) if i >= 19 else None
                c['vol_ma20'] = sum(vols[max(0,i-19):i+1])/min(20,i+1) if i >= 19 else None
                c['roc5'] = ((closes[i]/closes[i-5]-1)*100) if i >= 5 and closes[i-5]>0 else None
                c['roc20'] = ((closes[i]/closes[i-20]-1)*100) if i >= 20 and closes[i-20]>0 else None
                if i >= 14:
                    gains, losses = [], []
                    for j in range(max(1,i-13), i+1):
                        ch = closes[j] - closes[j-1]
                        gains.append(max(0,ch)); losses.append(max(0,-ch))
                    ag = sum(gains)/14; al = sum(losses)/14 or 0.001
                    c['rsi'] = 100 - 100/(1+ag/al)
                else:
                    c['rsi'] = None
    
    conn.close()
    return data
