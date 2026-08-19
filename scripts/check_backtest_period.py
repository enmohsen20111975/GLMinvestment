import sqlite3

db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row

print("=== predictions: date range ===")
dates = db.execute("SELECT MIN(prediction_date) as min_d, MAX(prediction_date) as max_d FROM predictions").fetchone()
print(f"  from {dates['min_d']} to {dates['max_d']}")

print("\n=== predictions: count in 2025-12-01 to 2026-06-17 ===")
cnt = db.execute("""
    SELECT COUNT(*) as c FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
""").fetchone()
print(f"  count: {cnt['c']}")

print("\n=== predictions: by month in period ===")
months = db.execute("""
    SELECT substr(prediction_date, 1, 7) as month, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY month ORDER BY month
""").fetchall()
for m in months:
    print(f"  {m['month']}: {m['c']}")

print("\n=== predictions: by market in period ===")
markets = db.execute("""
    SELECT market, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY market
""").fetchall()
for m in markets:
    print(f"  {m['market']}: {m['c']}")

print("\n=== predictions: by channel (morning_bell) in period ===")
mb = db.execute("""
    SELECT morning_bell, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY morning_bell
""").fetchall()
for m in mb:
    print(f"  morning_bell={m['morning_bell']}: {m['c']}")

print("\n=== predictions: by persona in period ===")
personas = db.execute("""
    SELECT persona, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY persona
""").fetchall()
for p in personas:
    print(f"  persona={p['persona']}: {p['c']}")

print("\n=== predictions: status in period ===")
statuses = db.execute("""
    SELECT status, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY status
""").fetchall()
for s in statuses:
    print(f"  status={s['status']}: {s['c']}")

print("\n=== predictions: hit_target/hit_stop in period ===")
ht = db.execute("""
    SELECT hit_target, hit_stop, COUNT(*) as c
    FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
    GROUP BY hit_target, hit_stop
""").fetchall()
for h in ht:
    print(f"  hit_target={h['hit_target']}, hit_stop={h['hit_stop']}: {h['c']}")

print("\n=== predictions: entry_price quality in period ===")
zero = db.execute("""
    SELECT COUNT(*) as c FROM predictions
    WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
      AND (entry_price IS NULL OR entry_price <= 0)
""").fetchone()
print(f"  entry_price <= 0: {zero['c']}")

print("\n=== predictions: duplicates in period ===")
dups = db.execute("""
    SELECT COUNT(*) as c FROM (
        SELECT ticker, prediction_date, persona, entry_price
        FROM predictions
        WHERE prediction_date >= '2025-12-01' AND prediction_date <= '2026-06-17'
        GROUP BY ticker, prediction_date, persona, entry_price
        HAVING COUNT(*) > 1
    )
""").fetchone()
print(f"  duplicate keys: {dups['c']}")

print("\n=== price_history.db: date range ===")
db2 = sqlite3.connect('db/price_history.db')
db2.row_factory = sqlite3.Row
ph_dates = db2.execute("SELECT MIN(date) as min_d, MAX(date) as max_d, COUNT(*) as c FROM price_history").fetchone()
print(f"  from {ph_dates['min_d']} to {ph_dates['max_d']} | total: {ph_dates['c']}")

print("\n=== price_history: count of tickers with data in period ===")
tickers_cnt = db2.execute("""
    SELECT COUNT(DISTINCT ticker) as c FROM price_history
    WHERE date >= '2025-12-01' AND date <= '2026-06-17'
""").fetchone()
print(f"  distinct tickers: {tickers_cnt['c']}")
