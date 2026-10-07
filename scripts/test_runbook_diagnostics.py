import sqlite3
import os

print("=" * 65)
print("RUNBOOK DIAGNOSTICS SUITE")
print("=" * 65)

# 1.1 Pipeline Freshness Check
checks = [
    ('db/stocks.db', 'stocks', 'last_update'),
    ('db/stocks.db', 'stock_daily_prices', 'fetch_time'),
    ('db/price_history.db', 'price_history', 'created_at'),
    ('db/data_engine.db', 'crypto_prices', 'timestamp'),
    ('db/data_engine.db', 'gold_prices', 'timestamp'),
    ('db/intraday.db', 'stock_intraday', 'timestamp'),
]

print("\n--- 1.1 Pipeline Freshness Check ---")
for db, table, col in checks:
    if not os.path.exists(db):
        print(f"  {db}.{table}: FILE NOT FOUND")
        continue
    try:
        conn = sqlite3.connect(db)
        row = conn.execute(f"SELECT MAX({col}) FROM {table}").fetchone()
        print(f"  {db}.{table}: latest = {row[0] if row else 'NULL'}")
        conn.close()
    except Exception as e:
        print(f"  {db}.{table}: ERROR {e}")

# 1.4 Multi-source problem in price_history.db
print("\n--- 1.4 Multi-Source Problem Check (price_history.db) ---")
if os.path.exists('db/price_history.db'):
    conn = sqlite3.connect('db/price_history.db')
    try:
        sources = conn.execute("SELECT source, COUNT(*), COUNT(DISTINCT ticker) FROM price_history GROUP BY source").fetchall()
        print("  Sources distribution:")
        for s in sources:
            print(f"    - {s[0]}: {s[1]:,} rows across {s[2]} tickers")
        multi = conn.execute("""
            SELECT COUNT(*) FROM (
                SELECT ticker FROM price_history GROUP BY ticker HAVING COUNT(DISTINCT source) > 1
            )
        """).fetchone()[0]
        print(f"  Tickers with multiple sources: {multi}")
    except Exception as e:
        print(f"  ERROR: {e}")
    finally:
        conn.close()

# 1.5 Close column NULL check in stocks.db
print("\n--- 1.5 Close Column NULL Check (stocks.db) ---")
if os.path.exists('db/stocks.db'):
    conn = sqlite3.connect('db/stocks.db')
    try:
        # Check columns of stocks
        cols = [r[1] for r in conn.execute("PRAGMA table_info(stocks)").fetchall()]
        print(f"  Columns in stocks table: {', '.join(cols[:10])}...")
        if 'close' in cols:
            null_close = conn.execute("SELECT COUNT(*) FROM stocks WHERE close IS NULL").fetchone()[0]
            total_stocks = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
            print(f"  Stocks with close IS NULL: {null_close} / {total_stocks}")
        elif 'current_price' in cols:
            null_price = conn.execute("SELECT COUNT(*) FROM stocks WHERE current_price IS NULL").fetchone()[0]
            total_stocks = conn.execute("SELECT COUNT(*) FROM stocks").fetchone()[0]
            print(f"  Stocks with current_price IS NULL: {null_price} / {total_stocks}")
    except Exception as e:
        print(f"  ERROR: {e}")
    finally:
        conn.close()

print("\n--- 1.6 Price Sample (stocks.db / price_history.db) ---")
if os.path.exists('db/stocks.db'):
    conn = sqlite3.connect('db/stocks.db')
    try:
        sample_tickers = ['COMI', 'SWDY', 'ETEL', 'AMOC', 'FWRY']
        for t in sample_tickers:
            row = conn.execute("SELECT ticker, name_ar, current_price, change_percent, last_update FROM stocks WHERE ticker = ?", (t,)).fetchone()
            if row:
                print(f"  {row[0]:6s} | {row[1]:15s} | Price: {row[2]} | Change: {row[3]}% | Updated: {row[4]}")
            else:
                print(f"  {t:6s} | NOT FOUND in stocks.db")
    except Exception as e:
        print(f"  ERROR: {e}")
    finally:
        conn.close()
