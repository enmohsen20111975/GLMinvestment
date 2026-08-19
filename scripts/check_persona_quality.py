import sqlite3

db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row

print("=== persona_predictions: profit_loss_percent distribution ===")
plp = db.execute("""
    SELECT COUNT(*) as c,
           SUM(CASE WHEN profit_loss_percent IS NOT NULL THEN 1 ELSE 0 END) as with_plp,
           SUM(CASE WHEN final_price IS NOT NULL THEN 1 ELSE 0 END) as with_final
    FROM persona_predictions
""").fetchone()
print(f"  total: {plp['c']} | with profit_loss_percent: {plp['with_plp']} | with final_price: {plp['with_final']}")

print("\n=== persona_predictions: sample with profit_loss_percent ===")
rows = db.execute("""
    SELECT ticker, market, persona, persona_type, prediction_date, entry_price,
           target_price, stop_loss, final_price, profit_loss_percent,
           hit_target, hit_stop_loss, status
    FROM persona_predictions
    WHERE profit_loss_percent IS NOT NULL
    LIMIT 10
""").fetchall()
for r in rows:
    print(dict(r))

print("\n=== persona_predictions: duplicates detail (ticker + prediction_date + persona + entry_price) ===")
dups = db.execute("""
    SELECT ticker, prediction_date, persona, entry_price, COUNT(*) as c,
           GROUP_CONCAT(id) as ids
    FROM persona_predictions
    GROUP BY ticker, prediction_date, persona, entry_price
    HAVING c > 1
    LIMIT 5
""").fetchall()
for d in dups:
    print(f"  {d['ticker']} | {d['prediction_date']} | {d['persona']} | entry={d['entry_price']} | count={d['c']} | ids={d['ids'][:60]}")

print("\n=== persona_predictions: persona_type distribution ===")
pt = db.execute("SELECT persona_type, COUNT(*) as c FROM persona_predictions GROUP BY persona_type").fetchall()
for p in pt:
    print(f"  persona_type={p['persona_type']}: {p['c']}")

print("\n=== persona_predictions: entry_price = 0 or NULL ===")
zero = db.execute("SELECT COUNT(*) as c FROM persona_predictions WHERE entry_price IS NULL OR entry_price <= 0").fetchone()
print(f"  entry_price <= 0: {zero['c']}")
