import sqlite3

print("=== persona_predictions columns ===")
db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row
cols = db.execute("PRAGMA table_info(persona_predictions)").fetchall()
for c in cols:
    print(f"  {c['name']} ({c['type']})")

print("\n=== persona_predictions sample (3 rows) ===")
rows = db.execute("SELECT * FROM persona_predictions LIMIT 3").fetchall()
for r in rows:
    print(dict(r))

print("\n=== persona_predictions status distribution ===")
statuses = db.execute("SELECT status, COUNT(*) as c FROM persona_predictions GROUP BY status").fetchall()
for s in statuses:
    print(f"  {s['status']}: {s['c']}")

print("\n=== persona_predictions persona distribution ===")
personas = db.execute("SELECT persona, COUNT(*) as c FROM persona_predictions GROUP BY persona").fetchall()
for p in personas:
    print(f"  {p['persona']}: {p['c']}")

print("\n=== persona_predictions: closed trades with PnL ===")
closed = db.execute("""
    SELECT ticker, persona, signal, signal_type, prediction_date, entry_price,
           target_price, stop_loss, final_price, profit_loss_percent,
           hit_target, hit_stop_loss, status, pnl_pct
    FROM persona_predictions
    WHERE status IN ('closed', 'CLOSED', 'hit_target', 'hit_stop', 'expired')
       OR profit_loss_percent IS NOT NULL
    LIMIT 5
""").fetchall()
for r in closed:
    print(dict(r))

print("\n=== count of closed with pnl ===")
cnt = db.execute("""
    SELECT COUNT(*) as c FROM persona_predictions
    WHERE profit_loss_percent IS NOT NULL AND status != 'PENDING'
""").fetchone()
print(f"  closed with pnl: {cnt['c']}")

print("\n=== predictions table columns ===")
cols2 = db.execute("PRAGMA table_info(predictions)").fetchall()
for c in cols2:
    print(f"  {c['name']} ({c['type']})")
