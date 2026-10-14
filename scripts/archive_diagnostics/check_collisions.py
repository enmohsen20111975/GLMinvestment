import sqlite3
import re

conn = sqlite3.connect('db/price_history.db')
bad = conn.execute("""
    SELECT DISTINCT ticker FROM price_history 
    WHERE LENGTH(ticker) > 6 OR ticker LIKE '% %' 
    OR ticker GLOB '*[A-Z][a-z]*[A-Z]*'
    ORDER BY ticker
""").fetchall()

collisions = 0
safe_updates = 0
for (bad_ticker,) in bad:
    match = re.match(r'^([A-Z]{2,6})', bad_ticker)
    if not match: continue
    clean = match.group(1)
    
    # Check if there are dates in bad_ticker that already exist in clean
    bad_dates = [r[0] for r in conn.execute("SELECT date FROM price_history WHERE ticker = ?", (bad_ticker,)).fetchall()]
    clean_dates = set(r[0] for r in conn.execute("SELECT date FROM price_history WHERE ticker = ?", (clean,)).fetchall())
    
    overlap = set(bad_dates) & clean_dates
    if overlap:
        collisions += 1
        print(f"Collision for {bad_ticker} -> {clean}: {len(overlap)} overlapping dates: {list(overlap)[:3]}")
    else:
        safe_updates += 1

print(f"\nCollisions found: {collisions}, Safe updates: {safe_updates}")
conn.close()
