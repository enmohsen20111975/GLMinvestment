#!/usr/bin/env python3
"""BRAVO-SCANNER-DBSLUG-FIX migration: 'egypt' -> 'EGX' + symbol backfill."""
import sqlite3

DB = "/home/z/my-project/db/stocks.db"
conn = sqlite3.connect(DB)
cur = conn.cursor()

Q_NULL = "SELECT COUNT(*) FROM stocks WHERE symbol IS NULL"
Q_DP_EGYPT = "SELECT COUNT(*) FROM stock_daily_prices WHERE market='egypt'"
Q_DP_EGX = "SELECT COUNT(*) FROM stock_daily_prices WHERE market='EGX'"
Q_SI_EGYPT = "SELECT COUNT(*) FROM stock_indicators WHERE market='egypt'"
Q_SI_EGX = "SELECT COUNT(*) FROM stock_indicators WHERE market='EGX'"

print("===== BEFORE =====")
for r in cur.execute("SELECT market, COUNT(*) FROM stocks GROUP BY market ORDER BY 1").fetchall():
    print(f"  stocks.{r[0]}: {r[1]}")
print(f"  stocks.symbol IS NULL: {cur.execute(Q_NULL).fetchone()[0]}")
print(f"  daily_prices.egypt: {cur.execute(Q_DP_EGYPT).fetchone()[0]}")
print(f"  daily_prices.EGX:   {cur.execute(Q_DP_EGX).fetchone()[0]}")
print(f"  indicators.egypt:   {cur.execute(Q_SI_EGYPT).fetchone()[0]}")
print(f"  indicators.EGX:     {cur.execute(Q_SI_EGX).fetchone()[0]}")

print("\n===== MIGRATING (atomic) =====")
cur.execute("BEGIN")
try:
    n1 = cur.execute("UPDATE stock_daily_prices SET market='EGX' WHERE market='egypt'").rowcount
    n2 = cur.execute("UPDATE stock_indicators SET market='EGX' WHERE market='egypt'").rowcount
    n3 = cur.execute("UPDATE stocks SET market='EGX' WHERE market='egypt'").rowcount
    n4 = cur.execute("UPDATE stocks SET symbol = ticker WHERE symbol IS NULL AND ticker IS NOT NULL").rowcount
    cur.execute("COMMIT")
    print(f"  daily_prices: {n1} rows egypt -> EGX")
    print(f"  indicators:   {n2} rows egypt -> EGX")
    print(f"  stocks:       {n3} rows egypt -> EGX")
    print(f"  stocks:       {n4} rows symbol backfilled from ticker")
except Exception as e:
    cur.execute("ROLLBACK")
    print(f"  ROLLBACK: {e}")
    raise

print("\n===== AFTER =====")
for r in cur.execute("SELECT market, COUNT(*) FROM stocks GROUP BY market ORDER BY 1").fetchall():
    print(f"  stocks.{r[0]}: {r[1]}")
print(f"  stocks.symbol IS NULL: {cur.execute(Q_NULL).fetchone()[0]}")
print(f"  daily_prices.egypt: {cur.execute(Q_DP_EGYPT).fetchone()[0]}")
print(f"  daily_prices.EGX:   {cur.execute(Q_DP_EGX).fetchone()[0]}")
print(f"  indicators.egypt:   {cur.execute(Q_SI_EGYPT).fetchone()[0]}")
print(f"  indicators.EGX:     {cur.execute(Q_SI_EGX).fetchone()[0]}")

print("\n===== COMI verification =====")
for r in cur.execute("SELECT symbol, ticker, market, current_price, last_updated FROM stocks WHERE ticker='COMI'").fetchall():
    print(f"  stocks: symbol={r[0]!r} ticker={r[1]!r} market={r[2]!r} price={r[3]} last={r[4]}")
for r in cur.execute("SELECT market, COUNT(*), MAX(price_date) FROM stock_daily_prices WHERE ticker='COMI' GROUP BY market").fetchall():
    print(f"  daily_prices: market={r[0]!r} rows={r[1]} latest={r[2]}")
for r in cur.execute("SELECT market, COUNT(*), MAX(date) FROM stock_indicators WHERE ticker='COMI' GROUP BY market").fetchall():
    print(f"  indicators: market={r[0]!r} rows={r[1]} latest={r[2]}")

conn.close()
print("\nMigration complete.")
