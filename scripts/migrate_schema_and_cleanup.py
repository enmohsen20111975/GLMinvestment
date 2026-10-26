#!/usr/bin/env python3
"""Step 2+4: Schema migration (DEFAULT 'US' → 'EGX') + data cleanup on stocks.db"""
import sqlite3

DB = 'db/stocks.db'
c = sqlite3.connect(DB)
cur = c.cursor()

try:
    cur.execute("BEGIN")
    # 1. Data cleanup: UPDATE contaminated rows from stocks table lookup
    print("=== before cleanup ===")
    cur.execute("SELECT market, COUNT(*) FROM stock_daily_prices GROUP BY market")
    for r in cur.fetchall():
        print(f"  {r[0]}: {r[1]}")

    cur.execute("""
        UPDATE stock_daily_prices
        SET market = (SELECT s.market FROM stocks s WHERE s.ticker = stock_daily_prices.ticker)
        WHERE market != (SELECT s.market FROM stocks s WHERE s.ticker = stock_daily_prices.ticker)
        AND EXISTS (SELECT 1 FROM stocks s WHERE s.ticker = stock_daily_prices.ticker)
    """)
    updated = cur.rowcount
    print(f"\n=== rows updated: {updated} ===")

    print("\n=== after cleanup ===")
    cur.execute("SELECT market, COUNT(*) FROM stock_daily_prices GROUP BY market")
    for r in cur.fetchall():
        print(f"  {r[0]}: {r[1]}")

    cur.execute("COMMIT")
    print("\n✅ Data cleanup COMMITTED")

    # 2. Schema migration: change DEFAULT via writable_schema (avoids trigger issues)
    cur2 = c.cursor()
    cur2.execute("BEGIN")
    cur2.execute("PRAGMA writable_schema=ON")
    cur2.execute("SELECT sql FROM sqlite_master WHERE name='stock_daily_prices'")
    old = cur2.fetchone()[0]
    new = old.replace("market TEXT DEFAULT 'US'", "market TEXT DEFAULT 'EGX'")
    cur2.execute("UPDATE sqlite_master SET sql=? WHERE name='stock_daily_prices'", (new,))
    cur2.execute("PRAGMA writable_schema=OFF")
    cur2.execute("COMMIT")
    print("✅ Schema migration COMMITTED (DEFAULT 'US' → 'EGX')")

    # 3. Verify
    c2 = sqlite3.connect(f'file:{DB}?mode=ro', uri=True)
    cu = c2.cursor()
    cu.execute("SELECT sql FROM sqlite_master WHERE name='stock_daily_prices'")
    s = cu.fetchone()[0]
    has_egx = "DEFAULT 'EGX'" in s
    print(f"\n=== Verification: DEFAULT 'EGX' in schema: {has_egx} ===")
    c2.close()
    c.close()
except Exception as e:
    try:
        cur.execute("ROLLBACK")
    except:
        pass
    print(f"❌ ERROR: {e}")
    c.close()
    raise
