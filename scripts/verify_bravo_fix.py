#!/usr/bin/env python3
"""Verify scanner fix: data lands under market='EGX' with symbol NOT NULL."""
import sqlite3

DB = "/home/z/my-project/db/stocks.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

print("===== POST-SCAN VERIFICATION =====")

# 1. No 'egypt' market should exist anywhere now
q_dp_egypt = "SELECT COUNT(*) FROM stock_daily_prices WHERE market='egypt'"
q_si_egypt = "SELECT COUNT(*) FROM stock_indicators WHERE market='egypt'"
q_st_egypt = "SELECT COUNT(*) FROM stocks WHERE market='egypt'"
print(f"  stocks WHERE market='egypt':       {cur.execute(q_st_egypt).fetchone()[0]} (must be 0)")
print(f"  daily_prices WHERE market='egypt': {cur.execute(q_dp_egypt).fetchone()[0]} (must be 0)")
print(f"  indicators WHERE market='egypt':   {cur.execute(q_si_egypt).fetchone()[0]} (must be 0)")

# 2. EGX counts
q_dp_egx = "SELECT COUNT(*), MAX(price_date), MAX(fetch_time) FROM stock_daily_prices WHERE market='EGX'"
q_si_egx = "SELECT COUNT(*), MAX(date), MAX(fetch_time) FROM stock_indicators WHERE market='EGX'"
q_st_egx = "SELECT COUNT(*), MAX(last_updated) FROM stocks WHERE market='EGX'"
r = cur.execute(q_st_egx).fetchone()
print(f"\n  stocks.EGX:       {r[0]} rows | last_updated={r[1]}")
r = cur.execute(q_dp_egx).fetchone()
print(f"  daily_prices.EGX: {r[0]} rows | latest_date={r[1]} | last_fetch={r[2]}")
r = cur.execute(q_si_egx).fetchone()
print(f"  indicators.EGX:   {r[0]} rows | latest_date={r[1]} | last_fetch={r[2]}")

# 3. symbol NULL check (must be 0)
q_null = "SELECT COUNT(*) FROM stocks WHERE symbol IS NULL"
print(f"\n  stocks.symbol IS NULL: {cur.execute(q_null).fetchone()[0]} (must be 0)")

# 4. COMI full check
print("\n===== COMI end-to-end check =====")
r = cur.execute("SELECT symbol, ticker, market, current_price, rsi, sma20, sma50, atr, volume, last_updated FROM stocks WHERE ticker='COMI'").fetchone()
print(f"  stocks: symbol={r[0]!r} ticker={r[1]!r} market={r[2]!r}")
print(f"          price={r[3]} rsi={r[4]} sma20={r[5]} sma50={r[6]} atr={r[7]} vol={r[8]} last={r[9]}")

print("\n  COMI daily_prices last 5 days:")
for row in cur.execute("SELECT price_date, close, volume FROM stock_daily_prices WHERE ticker='COMI' ORDER BY price_date DESC LIMIT 5").fetchall():
    print(f"    {row[0]}: close={row[1]} vol={row[2]}")

print("\n  COMI indicators:")
cols = [d[1] for d in cur.execute("PRAGMA table_info(stock_indicators)").fetchall()]
row = cur.execute("SELECT * FROM stock_indicators WHERE ticker='COMI' ORDER BY date DESC LIMIT 1").fetchone()
if row:
    for c, v in zip(cols, row):
        print(f"    {c}: {v}")

# 5. V3 view simulation: read what V3 reads
print("\n===== V3 view simulation (what V3 will now see) =====")
# V3 reads stock_daily_prices for a ticker (no market filter in the snapshot read, but market param drives ticker selection)
# Simulate: count EGX tickers with BOTH daily_prices history AND indicators today
q = """
SELECT COUNT(DISTINCT s.ticker)
FROM stocks s
WHERE s.market='EGX'
  AND EXISTS (SELECT 1 FROM stock_daily_prices p WHERE p.ticker=s.ticker AND p.close > 0)
  AND EXISTS (SELECT 1 FROM stock_indicators i WHERE i.ticker=s.ticker)
"""
print(f"  EGX stocks with BOTH price history AND indicators: {cur.execute(q).fetchone()[0]}")

# Sample 5 EGX stocks with full data
print("\n  Sample 5 EGX stocks (V3-ready):")
q2 = """
SELECT s.ticker, s.current_price, s.rsi, s.sma20, s.sma50,
       (SELECT COUNT(*) FROM stock_daily_prices p WHERE p.ticker=s.ticker) as days_hist
FROM stocks s
WHERE s.market='EGX' AND s.rsi IS NOT NULL
ORDER BY s.value_traded DESC
LIMIT 5
"""
for row in cur.execute(q2).fetchall():
    print(f"    {row[0]:8} price={row[1]:>10} rsi={row[2]:>6.2f} sma20={row[3]:>8} sma50={row[4]:>8} | {row[5]} days history")

conn.close()
print("\nVerification complete.")
