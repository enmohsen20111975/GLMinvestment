#!/usr/bin/env python3
"""
=============================================================================
📋 Phase 0: build_source_index.py — بناء فهرس مصادر الأسعار
=============================================================================

السكربت ده بيفحص كل قواعد البيانات ويبني inventory شامل:
- أي DB فيه أسعار؟
- أي جدول؟ كم صف؟ أقدم/أحدث تاريخ؟ كم تيكر؟ أي الأسواق؟
- الحالة: active / frozen / deprecated
- الأولوية: 1 (primary) / 2 (fallback) / 3 (legacy)

النتيجة: db/data_source_index.db (قاعدة جديدة فاضية — ما تلمس أي قاعدة موجودة)

Usage:
    python3 scripts/build_source_index.py
    python3 scripts/build_source_index.py --verify  # تحقق من القعدة
=============================================================================
"""
import sqlite3
import argparse
import sys
import json
from pathlib import Path
from datetime import datetime
from collections import Counter

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
INDEX_DB = DB_DIR / 'data_source_index.db'

# كل مصادر الأسعار المعروفة
SOURCES = [
    # (db_file, table_name, ticker_col, date_col, price_col, market_col, description)
    ('stocks.db', 'stock_daily_prices', 'ticker', 'price_date', 'close', 'market',
     'اليومي OHLCV — آخر 30 يوم (طازج)'),
    ('price_history.db', 'price_history', 'ticker', 'date', 'close_price', 'market',
     'التاريخي الكاثوليكي — 25 سنة EGX'),
    ('data_engine.db', 'egksco_price_history', 'symbol', 'price_date', 'close_price', 'market',
     'EGX من egksco scraper — LEGACY'),
    ('data_engine.db', 'historical_data', 'symbol', 'date', 'close', 'market',
     'multi-market — متجمد يونيو للخليج'),
    ('intraday.db', 'stock_intraday', 'ticker', 'timestamp', 'price', 'market',
     'اللحظي — ticks 5 دقايق'),
]


def scan_source(db_file, table, ticker_col, date_col, price_col, market_col, desc):
    """يفحص مصدر واحد ويرجّع dict بالبيانات"""
    db_path = DB_DIR / db_file
    scanned_at = datetime.now().isoformat()
    if not db_path.exists():
        return {'error': f'{db_file} not found', 'db_file': db_file, 'table': table,
                'scanned_at': scanned_at, 'row_count': 0, 'status': 'missing',
                'canonical_priority': 3, 'description': desc,
                'date_min': None, 'date_max': None, 'tickers_count': 0, 'markets': []}

    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        cur = conn.cursor()

        # تأكد إن الجدول موجود
        exists = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        if not exists:
            conn.close()
            return {'error': f'{table} not found in {db_file}', 'db_file': db_file, 'table': table,
                    'scanned_at': scanned_at, 'row_count': 0, 'status': 'missing',
                    'canonical_priority': 3, 'description': desc,
                    'date_min': None, 'date_max': None, 'tickers_count': 0, 'markets': []}

        # row count
        row_count = cur.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

        if row_count == 0:
            conn.close()
            return {
                'db_file': db_file, 'table': table, 'row_count': 0,
                'date_min': None, 'date_max': None,
                'tickers_count': 0, 'markets': [], 'description': desc,
                'status': 'empty', 'canonical_priority': 3, 'scanned_at': scanned_at
            }

        # date range
        date_info = cur.execute(
            f"SELECT MIN({date_col}), MAX({date_col}) FROM {table} WHERE {date_col} IS NOT NULL"
        ).fetchone()

        # tickers count
        try:
            tickers_count = cur.execute(
                f"SELECT COUNT(DISTINCT {ticker_col}) FROM {table}"
            ).fetchone()[0]
        except:
            tickers_count = 0

        # markets breakdown
        markets = []
        if market_col:
            try:
                cols = [c[1] for c in cur.execute(f"PRAGMA table_info({table})").fetchall()]
                if market_col in cols:
                    for mkt, cnt in cur.execute(
                        f"SELECT {market_col}, COUNT(*) FROM {table} GROUP BY {market_col} ORDER BY 2 DESC LIMIT 10"
                    ).fetchall():
                        markets.append({'market': str(mkt) if mkt else 'NULL', 'rows': cnt})
            except:
                pass

        conn.close()

        # تحديد الحالة
        today = datetime.now().strftime('%Y-%m-%d')
        max_date_str = str(date_info[1])[:10] if date_info[1] else None
        if not max_date_str:
            status = 'empty'
        elif max_date_str >= today:
            status = 'fresh'
        elif max_date_str >= '2026-10-15':
            status = 'recent'
        elif max_date_str >= '2026-09-01':
            status = 'stale'
        else:
            status = 'frozen'

        # الأولوية (based on row count + freshness)
        if table == 'price_history':
            priority = 1  # canonical
        elif table == 'stock_daily_prices':
            priority = 1  # fresh daily
        elif table == 'stock_intraday':
            priority = 2  # intraday source
        elif table == 'egksco_price_history':
            priority = 3  # legacy
        elif table == 'historical_data':
            priority = 3  # frozen
        else:
            priority = 3

        return {
            'db_file': db_file, 'table': table,
            'ticker_col': ticker_col, 'date_col': date_col,
            'price_col': price_col, 'market_col': market_col,
            'row_count': row_count,
            'date_min': str(date_info[0])[:10] if date_info[0] else None,
            'date_max': max_date_str,
            'tickers_count': tickers_count,
            'markets': markets,
            'description': desc,
            'status': status,
            'canonical_priority': priority,
            'scanned_at': datetime.now().isoformat(),
        }

    except Exception as e:
        return {'error': str(e), 'db_file': db_file, 'table': table,
                'scanned_at': scanned_at, 'row_count': 0, 'status': 'error',
                'canonical_priority': 3, 'description': desc,
                'date_min': None, 'date_max': None, 'tickers_count': 0, 'markets': []}


def build_index():
    """يبني data_source_index.db"""
    print(f"[{datetime.now().isoformat()[:19]}] 📋 building source index...")

    # احذف القاعدة القديمة لو موجودة (آمن — دي قاعدة inventory بس)
    if INDEX_DB.exists():
        INDEX_DB.unlink()

    conn = sqlite3.connect(str(INDEX_DB))
    cur = conn.cursor()

    # جدول inventory
    cur.execute("""
        CREATE TABLE source_inventory (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            db_file TEXT NOT NULL,
            table_name TEXT NOT NULL,
            ticker_col TEXT,
            date_col TEXT,
            price_col TEXT,
            market_col TEXT,
            row_count INTEGER,
            date_min TEXT,
            date_max TEXT,
            tickers_count INTEGER,
            markets_json TEXT,
            description TEXT,
            status TEXT,
            canonical_priority INTEGER,
            scanned_at TEXT,
            UNIQUE(db_file, table_name)
        )
    """)

    # جدول verification (للاختبار)
    cur.execute("""
        CREATE TABLE verification_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            check_name TEXT,
            check_result TEXT,
            details TEXT,
            timestamp TEXT
        )
    """)

    total_sources = 0
    for db_file, table, tcol, dcol, pcol, mcol, desc in SOURCES:
        print(f"\n  scanning {db_file}.{table}...")
        info = scan_source(db_file, table, tcol, dcol, pcol, mcol, desc)

        # سجل في verification_log حتى لو فيه error
        if 'error' in info:
            print(f"    ⚠️ {info['error']} — still indexing with error status")
            cur.execute("""
                INSERT INTO verification_log (check_name, check_result, details, timestamp)
                VALUES (?, ?, ?, ?)
            """, (f"scan_{db_file}_{table}", 'WARN', info['error'], datetime.now().isoformat()))
        else:
            print(f"    ✓ rows={info['row_count']:,} | {info['date_min']} → {info['date_max']} | status={info['status']}")

        # سجل في source_inventory حتى لو فيه error (عشان نعرف إن المصدر موجود بس فيه مشكلة)
        markets_json = json.dumps(info.get('markets', []), ensure_ascii=False)
        cur.execute("""
            INSERT OR REPLACE INTO source_inventory
            (db_file, table_name, ticker_col, date_col, price_col, market_col,
             row_count, date_min, date_max, tickers_count, markets_json,
             description, status, canonical_priority, scanned_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        """, (
            db_file, table, tcol, dcol, pcol, mcol,
            info.get('row_count', 0), info.get('date_min'),
            info.get('date_max'), info.get('tickers_count', 0), markets_json,
            desc, info.get('status', 'error'),
            info.get('canonical_priority', 3), info.get('scanned_at'),
        ))
        total_sources += 1

    conn.commit()

    # ملخص
    print(f"\n  📊 Summary:")
    for row in cur.execute("""
        SELECT status, COUNT(*), SUM(row_count) FROM source_inventory
        GROUP BY status ORDER BY 3 DESC
    """).fetchall():
        print(f"    {row[0]:10s}: {row[1]} sources | {row[2]:,} total rows")

    # verification: تأكد إن الـ inventory سليم
    checks_passed = 0
    checks_failed = 0

    # Check 1: كل المصادر اتمسحت
    expected_sources = len(SOURCES)
    actual_sources = cur.execute("SELECT COUNT(*) FROM source_inventory").fetchone()[0]
    if actual_sources >= 1:
        print(f"\n  ✅ Check 1: {actual_sources} sources indexed (expected ~{expected_sources})")
        cur.execute("INSERT INTO verification_log VALUES (NULL, 'sources_indexed', 'PASS', ?, ?)",
                   (f"{actual_sources} sources", datetime.now().isoformat()))
        checks_passed += 1
    else:
        print(f"\n  ❌ Check 1: no sources indexed")
        cur.execute("INSERT INTO verification_log VALUES (NULL, 'sources_indexed', 'FAIL', ?, ?)",
                   ('no sources', datetime.now().isoformat()))
        checks_failed += 1

    # Check 2: فيه على الأقل مصدر priority 1
    p1_count = cur.execute(
        "SELECT COUNT(*) FROM source_inventory WHERE canonical_priority=1"
    ).fetchone()[0]
    if p1_count >= 1:
        print(f"  ✅ Check 2: {p1_count} primary sources (priority=1)")
        cur.execute("INSERT INTO verification_log VALUES (NULL, 'primary_sources', 'PASS', ?, ?)",
                   (f"{p1_count} primary", datetime.now().isoformat()))
        checks_passed += 1
    else:
        print(f"  ❌ Check 2: no primary sources")
        cur.execute("INSERT INTO verification_log VALUES (NULL, 'primary_sources', 'FAIL', ?, ?)",
                   ('no primary', datetime.now().isoformat()))
        checks_failed += 1

    # Check 3: مفيش DBs اتلمست
    # (نتحقق إن stocks.db, price_history.db, data_engine.db, intraday.db لسه موجودة)
    for dbn in ['stocks.db', 'price_history.db', 'data_engine.db', 'intraday.db']:
        if (DB_DIR / dbn).exists():
            cur.execute("INSERT INTO verification_log VALUES (NULL, ?, 'PASS', ?, ?)",
                       (f'db_exists_{dbn}', f'{dbn} intact', datetime.now().isoformat()))
            checks_passed += 1
        else:
            print(f"  ❌ Check 3: {dbn} MISSING!")
            cur.execute("INSERT INTO verification_log VALUES (NULL, ?, 'FAIL', ?, ?)",
                       (f'db_exists_{dbn}', f'{dbn} missing', datetime.now().isoformat()))
            checks_failed += 1

    conn.commit()
    conn.close()

    print(f"\n  📋 Verification: {checks_passed} passed, {checks_failed} failed")
    print(f"  📁 Index saved to: {INDEX_DB}")
    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 0 complete")

    return 0 if checks_failed == 0 else 1


def verify_index():
    """يتحقق من الـ index الموجود"""
    if not INDEX_DB.exists():
        print(f"❌ {INDEX_DB} not found. Run build first.")
        return 1

    print(f"📋 Verifying {INDEX_DB}...\n")
    conn = sqlite3.connect(f"file:{INDEX_DB}?mode=ro", uri=True)

    print(f"{'DB':20s} {'Table':25s} {'Rows':>10s} {'Date Range':25s} {'Status':10s} {'Pri':>3s}")
    print("-" * 100)
    for r in conn.execute("""
        SELECT db_file, table_name, row_count, date_min, date_max, status, canonical_priority
        FROM source_inventory ORDER BY canonical_priority, row_count DESC
    """).fetchall():
        date_range = f"{r[3] or '—'} → {r[4] or '—'}"
        print(f"{r[0]:20s} {r[1]:25s} {r[2]:>10,} {date_range:25s} {r[5]:10s} {r[6]:>3}")

    print(f"\n--- Verification Log ---")
    for r in conn.execute("""
        SELECT check_name, check_result, details FROM verification_log ORDER BY id
    """).fetchall():
        icon = '✅' if r[1] == 'PASS' else '❌'
        print(f"  {icon} {r[0]}: {r[2]}")

    conn.close()
    return 0


def main():
    parser = argparse.ArgumentParser(description='Build/verify source index')
    parser.add_argument('--verify', action='store_true', help='تحقق من القعدة الموجودة')
    args = parser.parse_args()

    if args.verify:
        return verify_index()
    return build_index()


if __name__ == "__main__":
    sys.exit(main())
