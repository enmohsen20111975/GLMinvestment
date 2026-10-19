#!/usr/bin/env python3
"""BRAVO audit_data_integrity.py — verify data integrity after sanitization."""
import sqlite3, sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
PASS = 0; FAIL = 0

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {name}")
    else: FAIL += 1; print(f"  ✗ {name} — {detail}")

print("="*60)
print("BRAVO audit_data_integrity.py")
print("="*60)

# 1. stocks.db: 0 active stocks with zero/NULL price
print("\n1. Active stocks with zero/NULL price:")
c = sqlite3.connect(str(PROJECT_ROOT / 'db/stocks.db'))
n = c.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1 AND (current_price <= 0 OR current_price IS NULL)").fetchone()[0]
check(f"0 active stocks with zero price (got {n})", n == 0)
c.close()

# 2. stock_daily_prices: 0 bad close_price
print("\n2. Bad historical prices (close_price <= 0 or NULL):")
c = sqlite3.connect(str(PROJECT_ROOT / 'db/stocks.db'))
n = c.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE close_price <= 0 OR close_price IS NULL OR close <= 0 OR close IS NULL").fetchone()[0]
check(f"0 bad historical prices (got {n})", n == 0)
c.close()

# 3. stored_analyses: required columns present
print("\n3. stored_analyses required columns:")
c = sqlite3.connect(str(PROJECT_ROOT / 'db/predictions.db'))
cols = [r[1] for r in c.execute('PRAGMA table_info(stored_analyses)').fetchall()]
for req in ['market', 'signal', 'confidence', 'persona', 'master_score']:
    check(f"{req} present", req in cols)
c.close()

# 4. news_signals view exists
print("\n4. news_signals view:")
c = sqlite3.connect(str(PROJECT_ROOT / 'db/news.db'))
tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')").fetchall()]
check("news_signals exists", 'news_signals' in tables)
if 'news_signals' in tables:
    n = c.execute("SELECT COUNT(*) FROM news_signals").fetchone()[0]
    check(f"news_signals has data ({n} rows)", n > 0)
c.close()

# 5. DB integrity
print("\n5. DB integrity:")
for db in ['stocks.db', 'predictions.db', 'news.db', 'data_engine.db']:
    c = sqlite3.connect(str(PROJECT_ROOT / f'db/{db}'))
    row = c.execute('PRAGMA integrity_check').fetchone()
    check(f"{db} integrity OK", row[0] == 'ok')
    c.close()

print(f"\n{'='*60}")
print(f"RESULTS: {PASS} PASS / {FAIL} FAIL")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
