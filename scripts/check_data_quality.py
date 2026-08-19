import sqlite3

db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row

print("=== predictions: total count ===")
total = db.execute("SELECT COUNT(*) as c FROM predictions").fetchone()
print(f"  total: {total['c']}")

print("\n=== predictions: duplicates (ticker + prediction_date + persona + entry_price) ===")
dups = db.execute("""
    SELECT ticker, prediction_date, persona, entry_price, COUNT(*) as c
    FROM predictions
    GROUP BY ticker, prediction_date, persona, entry_price
    HAVING c > 1
    LIMIT 10
""").fetchall()
for d in dups:
    print(f"  {d['ticker']} | {d['prediction_date']} | {d['persona']} | entry={d['entry_price']} | count={d['c']}")
dup_count = db.execute("""
    SELECT COUNT(*) as c FROM (
        SELECT ticker, prediction_date, persona, entry_price
        FROM predictions
        GROUP BY ticker, prediction_date, persona, entry_price
        HAVING COUNT(*) > 1
    )
""").fetchone()
print(f"\n  صفقات مكررة (by key): {dup_count['c']}")

print("\n=== predictions: entry_price = 0 or NULL ===")
zero_entry = db.execute("SELECT COUNT(*) as c FROM predictions WHERE entry_price IS NULL OR entry_price <= 0").fetchone()
print(f"  entry_price <= 0: {zero_entry['c']}")

print("\n=== predictions: market distribution ===")
markets = db.execute("SELECT market, COUNT(*) as c FROM predictions GROUP BY market").fetchall()
for m in markets:
    print(f"  market={m['market']}: {m['c']}")

print("\n=== predictions: status distribution ===")
statuses = db.execute("SELECT status, COUNT(*) as c FROM predictions GROUP BY status").fetchall()
for s in statuses:
    print(f"  status={s['status']}: {s['c']}")

print("\n=== predictions: sample of EXPIRED with computed returns ===")
rows = db.execute("""
    SELECT ticker, market, persona, prediction_date, entry_price, target_price, stop_loss,
           hit_target, hit_stop, status, morning_bell
    FROM predictions
    WHERE status = 'EXPIRED'
    LIMIT 10
""").fetchall()
for r in rows:
    d = dict(r)
    entry = d['entry_price']
    target = d['target_price']
    stop = d['stop_loss']
    if entry and entry > 0:
        if d['hit_target'] == 1 and target:
            ret = ((target - entry) / entry) * 100
            print(f"  HIT_TARGET: {d['ticker']:6s} | market={d['market']} | entry={entry:.2f} | target={target:.2f} | ret={ret:.2f}%")
        elif d['hit_stop'] == 1 and stop:
            ret = ((stop - entry) / entry) * 100
            print(f"  HIT_STOP: {d['ticker']:6s} | market={d['market']} | entry={entry:.2f} | stop={stop:.2f} | ret={ret:.2f}%")
        else:
            print(f"  EXPIRED_NO_HIT: {d['ticker']:6s} | market={d['market']} | entry={entry:.2f}")

print("\n=== predictions: entry_price = 0 samples ===")
zeros = db.execute("SELECT ticker, market, prediction_date, entry_price, target_price, stop_loss, status FROM predictions WHERE entry_price IS NULL OR entry_price <= 0 LIMIT 5").fetchall()
for z in zeros:
    print(dict(z))

print("\n=== persona_predictions: total + dups ===")
pp_total = db.execute("SELECT COUNT(*) as c FROM persona_predictions").fetchone()
print(f"  persona_predictions total: {pp_total['c']}")
pp_dups = db.execute("""
    SELECT COUNT(*) as c FROM (
        SELECT ticker, prediction_date, persona, entry_price
        FROM persona_predictions
        GROUP BY ticker, prediction_date, persona, entry_price
        HAVING COUNT(*) > 1
    )
""").fetchone()
print(f"  persona_predictions dups: {pp_dups['c']}")

print("\n=== persona_predictions: market distribution ===")
pp_markets = db.execute("SELECT market, COUNT(*) as c FROM persona_predictions GROUP BY market").fetchall()
for m in pp_markets:
    print(f"  market={m['market']}: {m['c']}")

print("\n=== persona_predictions: status distribution ===")
pp_statuses = db.execute("SELECT status, COUNT(*) as c FROM persona_predictions GROUP BY status").fetchall()
for s in pp_statuses:
    print(f"  status={s['status']}: {s['c']}")
