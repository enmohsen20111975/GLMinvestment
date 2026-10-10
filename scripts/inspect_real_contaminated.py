import sqlite3
import re

conn = sqlite3.connect('db/price_history.db')

# Only tickers that actually contain lowercase letters or spaces!
bad = conn.execute("""
    SELECT DISTINCT ticker FROM price_history 
    WHERE ticker LIKE '% %' OR ticker GLOB '*[a-z]*'
    ORDER BY ticker
""").fetchall()

print(f"Actually contaminated tickers (with spaces or lowercase): {len(bad)}")
for b in bad:
    bad_ticker = b[0]
    # The clean ticker is the leading uppercase letters before the first lowercase or space
    # BUT wait: some company names start with an uppercase letter, e.g. 'ACAPA Capital' -> 'ACAP' + 'A Capital'
    # Or 'ACFRAlexandria' -> 'ACFR' + 'Alexandria'
    # Or 'ACTFAct' -> 'ACTF' + 'Act'
    # If followed by an uppercase word like 'Act' or 'Alexandria':
    # Let's inspect each:
    print(f"  '{bad_ticker}'")

conn.close()
