import sqlite3
import re

conn_ph = sqlite3.connect('db/price_history.db')
conn_s = sqlite3.connect('db/stocks.db')

bad_tickers = [r[0] for r in conn_ph.execute("""
    SELECT DISTINCT ticker FROM price_history 
    WHERE ticker LIKE '% %' OR ticker GLOB '*[a-z]*'
""").fetchall()]

print(f"Remaining bad tickers: {len(bad_tickers)}")
all_known_tickers = set(r[0] for r in conn_s.execute("SELECT ticker FROM stocks").fetchall())

resolved = 0
for b in bad_tickers:
    # Try finding which known ticker is a prefix of b
    found = None
    for length in range(6, 1, -1):
        prefix = b[:length]
        if prefix in all_known_tickers:
            found = prefix
            break
    if found:
        resolved += 1
        print(f"  MATCH: '{b}' -> Clean Ticker: '{found}'")
    else:
        print(f"  NO MATCH: '{b}'")

print(f"\nResolved by prefix matching: {resolved}/{len(bad_tickers)}")
conn_ph.close()
conn_s.close()
