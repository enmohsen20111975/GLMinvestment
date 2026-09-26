import sqlite3

def check_egx():
    conn = sqlite3.connect('db/intraday.db')
    conn.row_factory = sqlite3.Row
    cur = conn.cursor()

    for ticker in ['BONY', 'TAQA', 'JUFO', 'LCSN', 'TVNC', 'AIDC', 'EFID', 'DSCW']:
        rows = cur.execute("""
            SELECT ticker, price, change_percent, timestamp, high, low
            FROM stock_intraday
            WHERE ticker = ? OR ticker LIKE ?
            ORDER BY id DESC LIMIT 5
        """, (ticker, f"{ticker}%")).fetchall()

        print(f"=== Ticker: {ticker} ===")
        for r in rows:
            print("  ", dict(r))

if __name__ == '__main__':
    check_egx()
