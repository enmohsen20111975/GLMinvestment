#!/usr/bin/env python3
"""Compare all dbs between current and ultra archive."""
import sqlite3
import os

DBS = [
    "predictions.db", "stocks.db", "intraday.db", "data_engine.db",
    "historical.db", "auth.db", "analytics.db", "community.db",
    "crypto.db", "news.db", "learned.db", "gold_prices.db",
    "ai_search_cache.db", "telegram_data.db", "crypto-lab.db", "crypto_learning.db"
]
CUR_DIR = "/home/z/my-project/db"
ARC_DIR = "/tmp/ultra_extract"

def table_counts(path):
    """Get all tables and their row counts."""
    if not os.path.exists(path):
        return None
    con = sqlite3.connect(path)
    cur = con.cursor()
    try:
        tables = [r[0] for r in cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").fetchall()]
        result = {}
        for t in tables:
            try:
                cnt = cur.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
                result[t] = cnt
            except:
                result[t] = "ERR"
        con.close()
        return result
    except:
        con.close()
        return None

print(f"{'DB':<25} {'CUR_SIZE':>12} {'ARC_SIZE':>12} {'STATUS':<30}")
print("-" * 85)
for db in DBS:
    cur_path = os.path.join(CUR_DIR, db)
    arc_path = os.path.join(ARC_DIR, db)
    cur_sz = os.path.getsize(cur_path) if os.path.exists(cur_path) else 0
    arc_sz = os.path.getsize(arc_path) if os.path.exists(arc_path) else 0
    status = ""
    if arc_sz == 0:
        status = "NOT IN ARCHIVE"
    elif cur_sz == 0:
        status = "NOT IN CURRENT"
    elif arc_sz > cur_sz:
        status = f"ARCHIVE BIGGER (+{arc_sz-cur_sz:,})"
    elif cur_sz > arc_sz:
        status = f"CURRENT BIGGER (+{cur_sz-arc_sz:,})"
    else:
        status = "SAME SIZE"
    print(f"{db:<25} {cur_sz:>12,} {arc_sz:>12,} {status}")

print("\n\n=== DETAILED TABLE COUNTS ===\n")
for db in ["predictions.db", "stocks.db", "intraday.db", "data_engine.db"]:
    cur_path = os.path.join(CUR_DIR, db)
    arc_path = os.path.join(ARC_DIR, db)
    print(f"\n--- {db} ---")
    print(f"  CURRENT:")
    cur_tables = table_counts(cur_path)
    if cur_tables:
        for t, c in sorted(cur_tables.items(), key=lambda x: -x[1] if isinstance(x[1], int) else 0):
            print(f"    {t}: {c}")
    print(f"  ARCHIVE:")
    arc_tables = table_counts(arc_path)
    if arc_tables:
        for t, c in sorted(arc_tables.items(), key=lambda x: -x[1] if isinstance(x[1], int) else 0):
            print(f"    {t}: {c}")
