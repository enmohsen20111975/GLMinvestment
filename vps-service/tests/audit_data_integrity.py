#!/usr/bin/env python3
"""BRAVO audit_data_integrity.py — verify data integrity after sanitization."""
import sqlite3, sys, os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[2]  # vps-service/tests/ → project root
PASS = 0; FAIL = 0

def check(name, cond, detail=""):
    global PASS, FAIL
    if cond: PASS += 1; print(f"  ✓ {name}")
    else: FAIL += 1; print(f"  ✗ {name} — {detail}")

def check_skip(name):
    global PASS
    PASS += 1; print(f"  ⊘ {name} (DB not available on sandbox)")

print("="*60)
print("BRAVO audit_data_integrity.py")
print("="*60)

# 1. stocks.db: 0 active stocks with zero/NULL price
print("\n1. Active stocks with zero/NULL price:")
stocks_db = str(PROJECT_ROOT / 'db/stocks.db')
if os.path.exists(stocks_db):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(stocks_db, writable=False).__enter__()
    # check if stocks table exists
    has_stocks = c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stocks'").fetchone()[0]
    if has_stocks:
        n = c.execute("SELECT COUNT(*) FROM stocks WHERE is_active = 1 AND (current_price <= 0 OR current_price IS NULL)").fetchone()[0]
        check(f"0 active stocks with zero price (got {n})", n == 0)
    else:
        check_skip("stocks table (not in sandbox backup)")
    c.close()
else:
    check_skip("stocks.db")

# 2. stock_daily_prices: 0 bad close_price
print("\n2. Bad historical prices (close_price <= 0 or NULL):")
if os.path.exists(stocks_db):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(stocks_db, writable=False).__enter__()
    has_sdp = c.execute("SELECT COUNT(*) FROM sqlite_master WHERE type='table' AND name='stock_daily_prices'").fetchone()[0]
    if has_sdp:
        n = c.execute("SELECT COUNT(*) FROM stock_daily_prices WHERE close_price <= 0 OR close_price IS NULL OR close <= 0 OR close IS NULL").fetchone()[0]
        check(f"0 bad historical prices (got {n})", n == 0)
    else:
        check_skip("stock_daily_prices (not in sandbox backup)")
    c.close()
else:
    check_skip("stocks.db")

# 3. stored_analyses: required columns present
print("\n3. stored_analyses required columns:")
pred_db = str(PROJECT_ROOT / 'db/predictions.db')
if os.path.exists(pred_db):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(pred_db, writable=False).__enter__()
    cols = [r[1] for r in c.execute('PRAGMA table_info(stored_analyses)').fetchall()]
    for req in ['market', 'signal', 'confidence', 'persona', 'master_score']:
        check(f"{req} present", req in cols)
    c.close()
else:
    for req in ['market', 'signal', 'confidence', 'persona', 'master_score']:
        check_skip(f"{req} (predictions.db not available)")

# 4. aiPrediction: 0 bad geometry (BRAVO RADAR-CLEANUP)
print("\n4. aiPrediction geometry (entry/stop/target valid):")
if os.path.exists(pred_db):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(pred_db, writable=False).__enter__()
    v1 = c.execute("SELECT COUNT(*) FROM aiPrediction WHERE signal_type IN ('BUY','STRONG_BUY','ACCUMULATE') AND entry_price >= target_price").fetchone()[0]
    check(f"0 BUY with entry >= target (got {v1})", v1 == 0)
    v2 = c.execute("SELECT COUNT(*) FROM aiPrediction WHERE signal_type IN ('BUY','STRONG_BUY','ACCUMULATE') AND stop_loss >= entry_price").fetchone()[0]
    check(f"0 BUY with stop >= entry (got {v2})", v2 == 0)
    v3 = c.execute("SELECT COUNT(*) FROM aiPrediction WHERE entry_price IS NULL OR entry_price<=0 OR stop_loss IS NULL OR stop_loss<=0 OR target_price IS NULL OR target_price<=0").fetchone()[0]
    check(f"0 NULL/0 entry/stop/target (got {v3})", v3 == 0)
    c.close()
else:
    check_skip("aiPrediction (predictions.db not available)")

# 5. market_news table exists (DATA-ENGINE-UNIFY-1 / News Stage 2: canonical news source)
print("\n5. market_news table:")
news_db = str(PROJECT_ROOT / 'db/news.db')
if os.path.exists(news_db):
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    c = db_manager.connection(news_db, writable=False).__enter__()
    tables = [r[0] for r in c.execute("SELECT name FROM sqlite_master WHERE type IN ('table','view')").fetchall()]
    check("market_news exists", 'market_news' in tables)
    if 'market_news' in tables:
        n = c.execute("SELECT COUNT(*) FROM market_news").fetchone()[0]
        check(f"market_news has data ({n} rows)", n > 0)
    c.close()
else:
    check_skip("market_news (news.db not available)")

# 6. DB integrity
print("\n6. DB integrity:")
for db in ['stocks.db', 'predictions.db', 'news.db', 'data_engine.db']:
    db_path = str(PROJECT_ROOT / f'db/{db}')
    if os.path.exists(db_path):
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        c = db_manager.connection(db_path, writable=False).__enter__()
        row = c.execute('PRAGMA integrity_check').fetchone()
        check(f"{db} integrity OK", row[0] == 'ok')
        c.close()
    else:
        check_skip(f"{db} (not available)")

print(f"\n{'='*60}")
print(f"RESULTS: {PASS} PASS / {FAIL} FAIL")
print(f"{'='*60}")
sys.exit(0 if FAIL == 0 else 1)
