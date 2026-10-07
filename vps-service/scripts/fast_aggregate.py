#!/usr/bin/env python3
"""
fast_aggregate.py — Aggregation سريع بـ SQL واحد بدل الـ loop
=================================================================
الـ intraday_aggregator.py الأصلي بيعمل loop على 976 ticker × 10 أيام
= ~10000 query، وبيـ block على DB locks من data-engine.

النسخة دي بتعمل الـ aggregation كله في SQL واحد (GROUP BY) + bulk INSERT.
 Zeit: ~5 ثواني بدل ساعات.

Usage:
    cd ~/GLMinvestment/vps-service
    python3 scripts/fast_aggregate.py

Author: RL-FIX-4-FAST
"""
import sqlite3
import os
import sys
import time
from datetime import datetime, timedelta
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
INTRADAY_DB = str(PROJECT_ROOT / 'db' / 'intraday.db')
PRICE_HISTORY_DB = str(PROJECT_ROOT / 'db' / 'price_history.db')
SOURCE = 'intraday_aggregated'


def main():
    print("=" * 60)
    print("⚡ FAST Aggregator — single-SQL bulk aggregation")
    print("=" * 60)

    if not os.path.exists(INTRADAY_DB):
        print(f"❌ intraday.db not found: {INTRADAY_DB}")
        return 1
    if not os.path.exists(PRICE_HISTORY_DB):
        print(f"❌ price_history.db not found: {PRICE_HISTORY_DB}")
        return 1

    # قبل
    ph = sqlite3.connect(PRICE_HISTORY_DB, timeout=30)
    ph.execute('PRAGMA busy_timeout = 30000')
    ph.execute("""
        CREATE TABLE IF NOT EXISTS price_history (
            ticker TEXT NOT NULL, date TEXT NOT NULL,
            open_price REAL, high_price REAL, low_price REAL,
            close_price REAL, volume REAL, source TEXT DEFAULT 'unknown',
            created_at TEXT DEFAULT (datetime('now')),
            PRIMARY KEY (ticker, date, source)
        )
    """)
    ph.execute("CREATE INDEX IF NOT EXISTS idx_price_history_ticker_date ON price_history(ticker, date)")
    before = ph.execute("SELECT MAX(date), COUNT(*) FROM price_history").fetchone()
    print(f"📊 BEFORE: MAX(date)={before[0]} | rows={before[1]}")

    # اتصل بـ intraday.db READ-ONLY (مفيش lock conflict مع data-engine)
    in_db = sqlite3.connect(f"file:{INTRADAY_DB}?mode=ro", uri=True, timeout=30)
    in_db.execute('PRAGMA busy_timeout = 30000')

    # شوف اللي متاح
    meta = in_db.execute("""
        SELECT COUNT(*), COUNT(DISTINCT ticker), MIN(substr(timestamp,1,10)), MAX(substr(timestamp,1,10))
        FROM stock_intraday WHERE price > 0 AND timestamp IS NOT NULL
    """).fetchone()
    print(f"📊 intraday: {meta[0]} rows, {meta[1]} tickers, dates {meta[2]} → {meta[3]}")

    cutoff = (datetime.utcnow() - timedelta(days=90)).strftime('%Y-%m-%d')
    print(f"📅 Cutoff: {cutoff} (آخر 90 يوم)")

    t0 = time.time()
    print("⚡ Running single-SQL aggregation + bulk INSERT...")

    # الـ aggregation كله في query واحدة:
    #   open  = أول price في اليوم (min timestamp)
    #   close = آخر price في اليوم (max timestamp)
    #   high  = max(high) — fallback to max(price)
    #   low   = min(low)  — fallback to min(price)
    #   volume = max(volume)
    rows = in_db.execute("""
        WITH agg AS (
            SELECT
                ticker,
                substr(timestamp, 1, 10) AS d,
                MAX(CASE WHEN high > 0 THEN high ELSE price END) AS hi,
                MIN(CASE WHEN low > 0 THEN low ELSE price END) AS lo,
                MAX(volume) AS vol
            FROM stock_intraday
            WHERE price > 0 AND timestamp IS NOT NULL
              AND substr(timestamp, 1, 10) >= ?
            GROUP BY ticker, substr(timestamp, 1, 10)
        ),
        oc AS (
            SELECT ticker, d,
                (SELECT price FROM stock_intraday x
                 WHERE x.ticker = a.ticker AND substr(x.timestamp,1,10) = a.d AND x.price > 0
                 ORDER BY x.timestamp ASC LIMIT 1) AS op,
                (SELECT price FROM stock_intraday x
                 WHERE x.ticker = a.ticker AND substr(x.timestamp,1,10) = a.d AND x.price > 0
                 ORDER BY x.timestamp DESC LIMIT 1) AS cl
            FROM agg a
        )
        SELECT a.ticker, a.d, COALESCE(o.op, a.hi), a.hi, a.lo, COALESCE(o.cl, a.hi), a.vol
        FROM agg a JOIN oc o ON a.ticker = o.ticker AND a.d = o.d
    """, (cutoff,)).fetchall()

    t1 = time.time()
    print(f"✅ Aggregated {len(rows)} (ticker,date) pairs in {t1-t0:.1f}s")

    if not rows:
        print("⚠️ No data to aggregate — check intraday.db")
        in_db.close()
        ph.close()
        return 1

    # bulk INSERT
    t2 = time.time()
    ph.executemany("""
        INSERT OR REPLACE INTO price_history
        (ticker, date, open_price, high_price, low_price, close_price, volume, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    """, [(r[0], r[1], r[2], r[3], r[4], r[5], r[6], SOURCE) for r in rows])
    ph.commit()
    t3 = time.time()
    print(f"✅ Bulk INSERT {len(rows)} rows in {t3-t2:.1f}s")

    # بعد
    after = ph.execute("SELECT MAX(date), COUNT(*) FROM price_history").fetchone()
    print("")
    print(f"📊 AFTER:  MAX(date)={after[0]} | rows={after[1]}")
    src = ph.execute("SELECT source, MAX(date), COUNT(*) FROM price_history WHERE source=? GROUP BY source", (SOURCE,)).fetchone()
    if src:
        print(f"   {SOURCE}: MAX={src[1]} | {src[2]} rows")
    print(f"⏱️ Total: {t3-t0:.1f}s")

    in_db.close()
    ph.close()
    return 0


if __name__ == '__main__':
    sys.exit(main())
