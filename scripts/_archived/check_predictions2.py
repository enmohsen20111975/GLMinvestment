import sqlite3

db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row

print("=== predictions columns ===")
cols = db.execute("PRAGMA table_info(predictions)").fetchall()
for c in cols:
    print(f"  {c['name']} ({c['type']})")

print("\n=== predictions status distribution ===")
statuses = db.execute("SELECT status, COUNT(*) as c FROM predictions GROUP BY status").fetchall()
for s in statuses:
    print(f"  {s['status']}: {s['c']}")

print("\n=== predictions: closed/verified sample ===")
rows = db.execute("""
    SELECT ticker, signal, signal_type, prediction_date, entry_price,
           target_price, stop_loss, actual_exit_price, pnl_pct, pnl_percent,
           hit_target, hit_stop, is_correct, holding_days, status,
           highest_price, lowest_price, exit_type, persona
    FROM predictions
    WHERE status NOT IN ('PENDING', 'pending', 'OPEN', 'open')
       OR actual_exit_price IS NOT NULL
       OR pnl_pct IS NOT NULL
       OR pnl_percent IS NOT NULL
    LIMIT 5
""").fetchall()
for r in rows:
    print(dict(r))

print("\n=== predictions: count with exit/pnl ===")
cnt1 = db.execute("SELECT COUNT(*) as c FROM predictions WHERE actual_exit_price IS NOT NULL").fetchone()
print(f"  with actual_exit_price: {cnt1['c']}")
cnt2 = db.execute("SELECT COUNT(*) as c FROM predictions WHERE pnl_pct IS NOT NULL").fetchone()
print(f"  with pnl_pct: {cnt2['c']}")
cnt3 = db.execute("SELECT COUNT(*) as c FROM predictions WHERE pnl_percent IS NOT NULL").fetchone()
print(f"  with pnl_percent: {cnt3['c']}")
cnt4 = db.execute("SELECT COUNT(*) as c FROM predictions WHERE hit_target = 1 OR hit_stop = 1").fetchone()
print(f"  with hit_target=1 OR hit_stop=1: {cnt4['c']}")

print("\n=== prediction_logs columns ===")
cols2 = db.execute("PRAGMA table_info(prediction_logs)").fetchall()
for c in cols2:
    print(f"  {c['name']} ({c['type']})")

print("\n=== prediction_logs sample ===")
rows2 = db.execute("SELECT * FROM prediction_logs LIMIT 2").fetchall()
for r in rows2:
    d = dict(r)
    # Truncate long fields
    for k in ['indicators_used', 'weights_snapshot', 'features_snapshot']:
        if k in d and d[k] and len(str(d[k])) > 80:
            d[k] = str(d[k])[:80] + '...'
    print(d)

print("\n=== prediction_logs: verified trades ===")
cnt5 = db.execute("SELECT COUNT(*) as c FROM prediction_logs WHERE verified = 1 OR actual_price IS NOT NULL").fetchone()
print(f"  verified: {cnt5['c']}")
verified_statuses = db.execute("SELECT outcome, COUNT(*) as c FROM prediction_logs GROUP BY outcome").fetchall()
for s in verified_statuses:
    print(f"  outcome={s['outcome']}: {s['c']}")
