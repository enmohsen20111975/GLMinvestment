import sqlite3
import re

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

conn_s = sqlite3.connect('db/stocks.db')
conn_s.row_factory = sqlite3.Row

total = conn_s.execute("SELECT count(*) FROM stocks").fetchone()[0]
egx_total = conn_s.execute("SELECT count(*) FROM stocks WHERE market = 'EGX' OR market IS NULL").fetchone()[0]
with_price = conn_s.execute("SELECT count(*) FROM stocks WHERE (market = 'EGX' OR market IS NULL) AND current_price > 0").fetchone()[0]

print(f"Total stocks in stocks.db: {total}")
print(f"EGX stocks total: {egx_total}")
print(f"EGX stocks with current_price > 0: {with_price}")

conn_ph = sqlite3.connect('db/price_history.db')
conn_ph.row_factory = sqlite3.Row

ph_tickers = [r[0] for r in conn_ph.execute("SELECT DISTINCT ticker FROM price_history").fetchall()]
print(f"Distinct tickers in price_history.db: {len(ph_tickers)}")

cur_s = conn_s.cursor()
updated_count = 0

for ticker in ph_tickers:
    latest = conn_ph.execute(
        "SELECT close_price, volume, date FROM price_history WHERE ticker = ? ORDER BY date DESC LIMIT 1",
        (ticker,)
    ).fetchone()
    if latest and latest['close_price'] and float(latest['close_price']) > 0:
        c_price = float(latest['close_price'])
        vol = parse_vol(latest['volume'])
        cur_s.execute(
            "UPDATE stocks SET current_price = ?, volume = ?, last_update = datetime('now') WHERE ticker = ?",
            (c_price, vol, ticker)
        )
        if cur_s.rowcount > 0:
            updated_count += 1

conn_s.commit()
print(f"Updated current_price and volume for {updated_count} stocks from price_history.db!")

with_price_after = conn_s.execute("SELECT count(*) FROM stocks WHERE (market = 'EGX' OR market IS NULL) AND current_price > 0").fetchone()[0]
print(f"EGX stocks with current_price > 0 AFTER SYNC: {with_price_after}")

conn_s.close()
conn_ph.close()
