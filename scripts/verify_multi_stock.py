import sys
import json
import sqlite3

sys.path.insert(0, 'vps-service')
from core.database import DatabaseManager

db = DatabaseManager()

test_tickers = ['CRST', 'COMI', 'ABUK', 'FWRY', 'EAST', 'SWDY', 'ORAS', 'PTCC', 'GETO', 'EKHO']

print(f"{'TICKER':<7} | {'PRICE':<7} | {'PREV':<7} | {'HIGH':<7} | {'LOW':<7} | {'52W_H':<8} | {'52W_L':<8} | {'STATUS'}")
print("=" * 80)

failures = 0
for t in test_tickers:
    stk = db.get_stock(t)
    if not stk:
        print(f"{t:<7} | NOT FOUND")
        failures += 1
        continue

    cp = float(stk['current_price'])
    pc = float(stk['previous_close'] or cp)
    hp = float(stk['high_price'])
    lp = float(stk['low_price'])
    h52 = float(stk['high_52w'])
    l52 = float(stk['low_52w'])

    issues = []
    if hp < cp:
        issues.append(f"High {hp} < Current {cp}")
    if lp > cp:
        issues.append(f"Low {lp} > Current {cp}")
    if lp <= 0:
        issues.append(f"Low {lp} <= 0")
    if hp < lp:
        issues.append(f"High {hp} < Low {lp}")
    if h52 < cp:
        issues.append(f"52w High {h52} < Current {cp}")
    if l52 > cp:
        issues.append(f"52w Low {l52} > Current {cp}")
    if h52 < l52:
        issues.append(f"52w High {h52} < 52w Low {l52}")

    status = "✅ PERFECT MATCH" if not issues else "❌ " + ", ".join(issues)
    if issues:
        failures += 1

    print(f"{t:<7} | {cp:<7.2f} | {pc:<7.2f} | {hp:<7.2f} | {lp:<7.2f} | {h52:<8.2f} | {l52:<8.2f} | {status}")

print("=" * 80)
if failures == 0:
    print(f"🎉 ALL {len(test_tickers)} TESTED STOCKS PASSED ALL VALIDATION INVARIANTS 100%!")
else:
    print(f"⚠️ {failures} stocks had issues.")
