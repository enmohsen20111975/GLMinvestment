import json
import urllib.request
import sqlite3

def run():
    print("=== CHECK SCREENER DATA FOR SCREENSHOT 2 TICKERS ===")
    tickers = ['HBCO', 'SNFI', 'ARCC', 'UTOP', 'ATQA', 'ABUK']
    conn = sqlite3.connect('db/stocks.db')
    c = conn.cursor()
    for t in tickers:
        c.execute("SELECT ticker, current_price, volume, turnover_egp, pe_ratio, roe, rsi FROM stocks WHERE ticker = ?", (t,))
        row = c.fetchone()
        print("DB row for", t, ":", row)
    conn.close()

    url = 'http://127.0.0.1:3000/api/screener/advanced?limit=20'
    req = urllib.request.urlopen(url)
    data = json.loads(req.read().decode('utf-8'))
    for s in data.get('stocks', []):
        if s.get('ticker') in tickers:
            print("API stock for", s.get('ticker'), "turnover_egp:", s.get('turnover_egp'), "pe_ratio:", s.get('pe_ratio'), "type(pe):", type(s.get('pe_ratio')))

if __name__ == '__main__':
    run()
