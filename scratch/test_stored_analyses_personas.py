import sqlite3
import json

conn = sqlite3.connect('db/predictions.db')
conn.row_factory = sqlite3.Row
cur = conn.cursor()

cur.execute("SELECT ticker, updated_at, analysis_json FROM stored_analyses WHERE market = 'EGX'")
rows = cur.fetchall()
print(f"Total stored_analyses for EGX: {len(rows)}")

gambler_cnt = 0
investor_cnt = 0
balanced_cnt = 0

for r in rows:
    raw = r['analysis_json']
    if not raw:
        continue
    try:
        data = json.loads(raw)
        g = data.get('gambler') or {}
        inv = data.get('investor') or {}
        prr = data.get('persona_rr') or {}
        
        if g.get('entry') or g.get('verdict'):
            gambler_cnt += 1
        if inv.get('entry') or inv.get('verdict'):
            investor_cnt += 1
        if prr.get('balanced'):
            balanced_cnt += 1
    except Exception as e:
        print("Error parsing:", e)

print(f"Gambler predictions in stored_analyses: {gambler_cnt}")
print(f"Investor/Conservative predictions in stored_analyses: {investor_cnt}")
print(f"Balanced predictions in stored_analyses: {balanced_cnt}")

conn.close()
