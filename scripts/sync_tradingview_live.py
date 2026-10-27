import urllib.request
import json
import sqlite3
from datetime import datetime

def sync_tv():
    url = "https://scanner.tradingview.com/egypt/scan"
    headers = {"User-Agent": "Mozilla/5.0", "Content-Type": "application/json"}
    payload = {
        "filter": [{"left": "type", "operation": "in_range", "right": ["stock", "dr", "fund"]}],
        "options": {"lang": "ar"},
        "markets": ["egypt"],
        "symbols": {"query": {"types": []}, "tickers": []},
        "columns": [
            "name", "description", "close", "change", "volume", "Value.Traded",
            "RSI", "open", "high", "low"
        ],
        "sort": {"sortBy": "Value.Traded", "sortOrder": "desc"},
        "range": [0, 350]
    }

    req = urllib.request.Request(url, data=json.dumps(payload).encode('utf-8'), headers=headers)
    with urllib.request.urlopen(req, timeout=15) as resp:
        res = json.loads(resp.read().decode('utf-8'))
    
    data = res.get('data', [])
    print(f"Fetched {len(data)} stocks from TradingView official scanner.")

    con = sqlite3.connect('db/stocks.db')
    cur = con.cursor()
    cur.execute("PRAGMA table_info(stock_daily_prices)")
    sdp_cols = [r[1] for r in cur.fetchall()]
    print("sdp cols:", sdp_cols)

    now_str = datetime.now().isoformat()
    today_str = datetime.now().strftime('%Y-%m-%d')
    updated = 0

    for r in data:
        ticker = r.get('s', '').replace('EGX:', '').strip()
        d = r.get('d', [])
        if not ticker or len(d) < 7:
            continue
        
        close_p = float(d[2]) if d[2] is not None else 0.0
        chg_pct = float(d[3]) if d[3] is not None else 0.0
        vol = float(d[4]) if d[4] is not None else 0.0
        turnover = float(d[5]) if d[5] is not None else 0.0
        rsi = float(d[6]) if d[6] is not None else None
        open_p = float(d[7]) if len(d) > 7 and d[7] is not None else close_p
        high_p = float(d[8]) if len(d) > 8 and d[8] is not None else close_p
        low_p = float(d[9]) if len(d) > 9 and d[9] is not None else close_p

        # Update stocks table
        cur.execute("""
            UPDATE stocks 
            SET current_price = ?,
                change_percent = ?,
                volume = ?,
                turnover_egp = ?,
                value_traded = ?,
                rsi = COALESCE(?, rsi),
                last_update = ?,
                last_updated = ?
            WHERE ticker = ?
        """, (close_p, chg_pct, vol, turnover, turnover, rsi, now_str, now_str, ticker))
        if cur.rowcount > 0:
            updated += 1

        # Also update stock_daily_prices for today
        cur.execute("""
            INSERT INTO stock_daily_prices (ticker, price_date, open_price, high_price, low_price, close_price, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
            ON CONFLICT(ticker, price_date) DO UPDATE SET
                open_price = excluded.open_price,
                high_price = excluded.high_price,
                low_price = excluded.low_price,
                close_price = excluded.close_price,
                volume = excluded.volume
        """, (ticker, today_str, open_p, high_p, low_p, close_p, vol))

    con.commit()
    con.close()
    print(f"Updated {updated} stocks in stocks.db with live TradingView Cash & Price data.")

if __name__ == '__main__':
    sync_tv()
