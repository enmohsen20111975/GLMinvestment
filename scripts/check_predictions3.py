import sqlite3

db = sqlite3.connect('db/predictions.db')
db.row_factory = sqlite3.Row

print("=== predictions: persona distribution ===")
personas = db.execute("SELECT persona, COUNT(*) as c FROM predictions GROUP BY persona").fetchall()
for p in personas:
    print(f"  {p['persona']}: {p['c']}")

print("\n=== predictions: morning_bell distribution ===")
mb = db.execute("SELECT morning_bell, COUNT(*) as c FROM predictions GROUP BY morning_bell").fetchall()
for m in mb:
    print(f"  morning_bell={m['morning_bell']}: {m['c']}")

print("\n=== predictions: hit_target / hit_stop breakdown ===")
print("  hit_target=1, hit_stop=0:", db.execute("SELECT COUNT(*) FROM predictions WHERE hit_target=1 AND hit_stop=0").fetchone()[0])
print("  hit_target=0, hit_stop=1:", db.execute("SELECT COUNT(*) FROM predictions WHERE hit_target=0 AND hit_stop=1").fetchone()[0])
print("  hit_target=0, hit_stop=0 (expired):", db.execute("SELECT COUNT(*) FROM predictions WHERE hit_target=0 AND hit_stop=0 AND status='EXPIRED'").fetchone()[0])

print("\n=== predictions: date range ===")
dates = db.execute("SELECT MIN(prediction_date) as min_d, MAX(prediction_date) as max_d FROM predictions").fetchone()
print(f"  from {dates['min_d']} to {dates['max_d']}")

print("\n=== predictions: sample with hit_target=1 (compute return) ===")
rows = db.execute("""
    SELECT ticker, persona, prediction_date, entry_price, target_price, stop_loss,
           hit_target, hit_stop, status, morning_bell
    FROM predictions
    WHERE hit_target=1 AND hit_stop=0 AND entry_price > 0 AND target_price > 0
    LIMIT 5
""").fetchall()
for r in rows:
    d = dict(r)
    # Compute return: (target - entry) / entry * 100
    ret = (d['target_price'] - d['entry_price']) / d['entry_price'] * 100
    print(f"  {d['ticker']} ({d['persona']}) entry={d['entry_price']:.2f} target={d['target_price']:.2f} → return={ret:.2f}%")

print("\n=== predictions: sample with hit_stop=1 (compute loss) ===")
rows2 = db.execute("""
    SELECT ticker, persona, prediction_date, entry_price, target_price, stop_loss,
           hit_target, hit_stop, status, morning_bell
    FROM predictions
    WHERE hit_target=0 AND hit_stop=1 AND entry_price > 0 AND stop_loss > 0
    LIMIT 5
""").fetchall()
for r in rows2:
    d = dict(r)
    # Compute loss: (stop - entry) / entry * 100
    ret = (d['stop_loss'] - d['entry_price']) / d['entry_price'] * 100
    print(f"  {d['ticker']} ({d['persona']}) entry={d['entry_price']:.2f} stop={d['stop_loss']:.2f} → return={ret:.2f}%")

print("\n=== predictions: expired with no hit (compute from final price if available) ===")
rows3 = db.execute("""
    SELECT ticker, persona, prediction_date, entry_price, target_price, stop_loss,
           hit_target, hit_stop, status, outcome_date, closed_at
    FROM predictions
    WHERE hit_target=0 AND hit_stop=0 AND status='EXPIRED'
    LIMIT 3
""").fetchall()
for r in rows3:
    print(dict(r))

print("\n=== ExpertRecommendation columns ===")
cols = db.execute("PRAGMA table_info(ExpertRecommendation)").fetchall()
for c in cols:
    print(f"  {c['name']} ({c['type']})")

print("\n=== ExpertRecommendation sample ===")
rows4 = db.execute("SELECT stock_symbol, action, entry_price, target_price, stop_loss, final_price, profit_loss_percent, hit_target, hit_stop_loss, status, session_date FROM ExpertRecommendation LIMIT 3").fetchall()
for r in rows4:
    print(dict(r))
