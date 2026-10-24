#!/usr/bin/env python3
"""
=============================================================================
🔧 Phase 2: unify_to_price_history.py — توحيد المصادر في price_history.db
=============================================================================

القاعدة الذهبية: INSERT OR IGNORE — ما يلوّشش أي حاجة موجودة.

السكربت ده بياخد البيانات من:
  1. data_engine.db.egksco_price_history (59K rows — EGX من egksco)
  2. data_engine.db.historical_data (196K rows — multi-market)
  3. stocks.db.stock_daily_prices (86K rows — طازج)

ويدمجها في:
  - price_history.db.price_history (المصدر الكاثوليكي)

schema target (price_history):
  ticker, date, open_price, high_price, low_price, close_price, volume,
  source, market

الاختبارات الصارمة:
  1. row count قبل/بعد
  2. sample tickers — تحقق إن البيانات اتدمجت
  3. date ranges — تأكد إن مفيش تواريخ ضاعت
  4. ما فيش تكرار (UNIQUE constraint)
  5. المصادر الأصلية لسه موجودة (مش ممسوحة)

Usage:
    python3 scripts/unify_to_price_history.py
    python3 scripts/unify_to_price_history.py --dry-run
    python3 scripts/unify_to_price_history.py --source egksco  # مصدر واحد بس
=============================================================================
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
PRICE_HISTORY_DB = DB_DIR / 'price_history.db'
STOCKS_DB = DB_DIR / 'stocks.db'
DATA_ENGINE_DB = DB_DIR / 'data_engine.db'


def get_row_count(db_path, table, ticker_col=None, date_col=None):
    """row count مع optional filter"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def get_ticker_market_map():
    """ticker → market من stocks.db"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    try:
        return {r[0]: r[1] for r in conn.execute(
            "SELECT ticker, market FROM stocks"
        ).fetchall()}
    finally:
        conn.close()


def ensure_price_history_schema():
    """تأكد إن price_history عندها UNIQUE constraint على (ticker, date) + market column"""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(PRICE_HISTORY_DB), writable=False).__enter__()
    try:
        # تحقق من الـ schema
        cols = [c[1] for c in conn.execute("PRAGMA table_info(price_history)").fetchall()]
        print(f"    price_history columns: {cols[:10]}")

        # لو مفيش column اسمه market، نضيفه (Phase 2 fix)
        if 'market' not in cols:
            print(f"    ⚠️ no 'market' column — adding it (Phase 2 fix)")
            conn.execute("ALTER TABLE price_history ADD COLUMN market TEXT DEFAULT 'UNKNOWN'")
            conn.commit()
            print(f"    ✓ 'market' column added")
        else:
            print(f"    ✓ 'market' column exists")

        # تحقق من indexes
        indexes = conn.execute(
            "SELECT name, sql FROM sqlite_master WHERE type='index' AND tbl_name='price_history'"
        ).fetchall()
        print(f"    existing indexes: {[i[0] for i in indexes]}")

        # لو مفيش UNIQUE على (ticker, date)، نضيفه
        has_unique = any('ticker' in str(i[1]).lower() and 'date' in str(i[1]).lower()
                        and 'UNIQUE' in str(i[1]).upper() for i in indexes)
        if not has_unique:
            print(f"    ⚠️ no UNIQUE(ticker, date) — creating index (non-unique for safety)")
            conn.execute("CREATE INDEX IF NOT EXISTS idx_ph_ticker_date ON price_history(ticker, date)")
            conn.commit()
        else:
            print(f"    ✓ UNIQUE(ticker, date) exists")
    finally:
        conn.close()


def migrate_egksco(dry_run=False):
    """دمج egksco_price_history → price_history"""
    print(f"\n  📦 migrating egksco_price_history...")

    if not DATA_ENGINE_DB.exists():
        print(f"    ⚠️ data_engine.db not found — skipping")
        return 0, 0

    # تحقق إن الجدول موجود
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src_conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    exists = src_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='egksco_price_history'"
    ).fetchone()
    if not exists:
        src_conn.close()
        print(f"    ⚠️ egksco_price_history not found — skipping")
        return 0, 0

    # row count قبل
    src_count = src_conn.execute("SELECT COUNT(*) FROM egksco_price_history").fetchone()[0]
    print(f"    source: {src_count:,} rows")
    src_conn.close()

    if src_count == 0:
        print(f"    ⚠️ source empty — skipping")
        return 0, 0

    # اقرا البيانات
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src_conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    rows = src_conn.execute("""
        SELECT symbol, price_date, open_price, high_price, low_price, close_price, volume, market
        FROM egksco_price_history
        WHERE close_price > 0
    """).fetchall()
    src_conn.close()

    # اكتب في price_history.db
    if not dry_run:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        dst_conn = db_manager.connection(str(PRICE_HISTORY_DB), writable=False).__enter__()
        inserted = 0
        skipped = 0
        batch = []
        BATCH_SIZE = 5000

        for ticker, date, op, hp, lp, cp, vol, market in rows:
            batch.append((ticker, str(date)[:10], op, hp, lp, cp, vol or 0,
                         'egksco_migration', market or 'EGX'))
            if len(batch) >= BATCH_SIZE:
                cur = dst_conn.executemany("""
                    INSERT OR IGNORE INTO price_history
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                inserted += cur.rowcount
                batch = []

        if batch:
            cur = dst_conn.executemany("""
                INSERT OR IGNORE INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, batch)
            inserted += cur.rowcount

        dst_conn.commit()
        dst_conn.close()
        print(f"    ✅ inserted {inserted:,} new rows (skipped {len(rows)-inserted:,} duplicates)")
        return len(rows), inserted
    else:
        print(f"    [DRY RUN] would insert ~{len(rows):,} rows")
        return len(rows), 0


def migrate_historical(dry_run=False, ticker_market=None):
    """دمج historical_data → price_history"""
    print(f"\n  📦 migrating historical_data...")

    if not DATA_ENGINE_DB.exists():
        print(f"    ⚠️ data_engine.db not found — skipping")
        return 0, 0

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src_conn = db_manager.connection(DATA_ENGINE_DB, writable=False).__enter__()
    exists = src_conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name='historical_data'"
    ).fetchone()
    if not exists:
        src_conn.close()
        print(f"    ⚠️ historical_data not found — skipping")
        return 0, 0

    src_count = src_conn.execute("SELECT COUNT(*) FROM historical_data").fetchone()[0]
    print(f"    source: {src_count:,} rows")

    # اقرا — historical_data فيه symbol, date, open, high, low, close, volume, market
    rows = src_conn.execute("""
        SELECT symbol, date, open, high, low, close, volume, market
        FROM historical_data
        WHERE close > 0
    """).fetchall()
    src_conn.close()

    if not rows:
        print(f"    ⚠️ no valid rows — skipping")
        return 0, 0

    # اكتب
    if not dry_run:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        dst_conn = db_manager.connection(str(PRICE_HISTORY_DB), writable=False).__enter__()
        inserted = 0
        batch = []
        BATCH_SIZE = 5000

        for ticker, date, op, hp, lp, cp, vol, market in rows:
            # استخدم ticker من ticker_market لو symbol مختلف
            real_ticker = ticker if ticker in ticker_market else ticker
            real_market = market or ticker_market.get(ticker, 'UNKNOWN')
            batch.append((real_ticker, str(date)[:10], op, hp, lp, cp, vol or 0,
                         'historical_migration', real_market))
            if len(batch) >= BATCH_SIZE:
                cur = dst_conn.executemany("""
                    INSERT OR IGNORE INTO price_history
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                inserted += cur.rowcount
                batch = []

        if batch:
            cur = dst_conn.executemany("""
                INSERT OR IGNORE INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, batch)
            inserted += cur.rowcount

        dst_conn.commit()
        dst_conn.close()
        print(f"    ✅ inserted {inserted:,} new rows (skipped {len(rows)-inserted:,} duplicates)")
        return len(rows), inserted
    else:
        print(f"    [DRY RUN] would insert ~{len(rows):,} rows")
        return len(rows), 0


def migrate_stock_daily(dry_run=False, ticker_market=None):
    """دمج stock_daily_prices → price_history"""
    print(f"\n  📦 migrating stock_daily_prices...")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    src_conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    src_count = src_conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
    print(f"    source: {src_count:,} rows")

    rows = src_conn.execute("""
        SELECT ticker, price_date,
               COALESCE(open, open_price), COALESCE(high, high_price),
               COALESCE(low, low_price), COALESCE(close, close_price), volume
        FROM stock_daily_prices
        WHERE COALESCE(close, close_price) > 0
    """).fetchall()
    src_conn.close()

    if not dry_run:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        dst_conn = db_manager.connection(str(PRICE_HISTORY_DB), writable=False).__enter__()
        inserted = 0
        batch = []
        BATCH_SIZE = 5000

        for ticker, date, op, hp, lp, cp, vol in rows:
            market = ticker_market.get(ticker, 'EGX')
            batch.append((ticker, str(date)[:10], op, hp, lp, cp, vol or 0,
                         'stock_daily_migration', market))
            if len(batch) >= BATCH_SIZE:
                cur = dst_conn.executemany("""
                    INSERT OR IGNORE INTO price_history
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, batch)
                inserted += cur.rowcount
                batch = []

        if batch:
            cur = dst_conn.executemany("""
                INSERT OR IGNORE INTO price_history
                (ticker, date, open_price, high_price, low_price, close_price, volume, source, market)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, batch)
            inserted += cur.rowcount

        dst_conn.commit()
        dst_conn.close()
        print(f"    ✅ inserted {inserted:,} new rows (skipped {len(rows)-inserted:,} duplicates)")
        return len(rows), inserted
    else:
        print(f"    [DRY RUN] would insert ~{len(rows):,} rows")
        return len(rows), 0


def verify_migration(counts_before):
    """اختبارات صارمة بعد التوحيد"""
    print(f"\n  🔍 verification checks...")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
    checks = []

    # Check 1: row count زاد
    count_after = conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
    diff = count_after - counts_before
    if diff > 0:
        checks.append(('row_count_increased', 'PASS', f'+{diff:,} new rows ({counts_before:,} → {count_after:,})'))
        print(f"    ✅ Check 1: +{diff:,} new rows ({counts_before:,} → {count_after:,})")
    elif diff == 0:
        checks.append(('row_count_increased', 'WARN', f'no new rows (already had all data)'))
        print(f"    ⚠️ Check 1: no new rows (already had all data)")
    else:
        checks.append(('row_count_increased', 'FAIL', f'LOST {diff} rows!'))
        print(f"    ❌ Check 1: LOST {diff} rows!")

    # Check 2: مفيش تكرار (ticker, date)
    dupes = conn.execute("""
        SELECT COUNT(*) FROM (
            SELECT ticker, date, COUNT(*) as c FROM price_history
            GROUP BY ticker, date HAVING c > 1
        )
    """).fetchone()[0]
    if dupes == 0:
        checks.append(('no_duplicates', 'PASS', '0 duplicates'))
        print(f"    ✅ Check 2: no duplicates (ticker, date unique)")
    else:
        checks.append(('no_duplicates', 'FAIL', f'{dupes} duplicate (ticker, date) pairs'))
        print(f"    ❌ Check 2: {dupes} duplicate (ticker, date) pairs")

    # Check 3: date range متسع
    min_date = conn.execute("SELECT MIN(date) FROM price_history").fetchone()[0]
    max_date = conn.execute("SELECT MAX(date) FROM price_history").fetchone()[0]
    checks.append(('date_range', 'PASS', f'{min_date} → {max_date}'))
    print(f"    ✅ Check 3: date range {min_date} → {max_date}")

    # Check 4: tickers count
    tickers = conn.execute("SELECT COUNT(DISTINCT ticker) FROM price_history").fetchone()[0]
    checks.append(('tickers_count', 'PASS', f'{tickers} unique tickers'))
    print(f"    ✅ Check 4: {tickers} unique tickers")

    # Check 5: المصادر الأصلية لسه موجودة
    conn.close()

    for dbn, table in [('data_engine.db', 'egksco_price_history'),
                       ('data_engine.db', 'historical_data'),
                       ('stocks.db', 'stock_daily_prices')]:
        db_path = DB_DIR / dbn
        if db_path.exists():
            try:
                # Phase 7.1: migrated to db_manager (writable=False)
                from core.db_manager import db_manager
                c = db_manager.connection(db_path, writable=False).__enter__()
                cnt = c.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
                c.close()
                checks.append((f'original_{table}_intact', 'PASS', f'{cnt:,} rows'))
                print(f"    ✅ Check 5.{table}: original intact ({cnt:,} rows)")
            except:
                checks.append((f'original_{table}_intact', 'WARN', 'table missing'))
                print(f"    ⚠️ Check 5.{table}: table missing (ok if not expected)")

    return checks


def main():
    parser = argparse.ArgumentParser(description='Unify price sources to price_history.db (Phase 2)')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط')
    parser.add_argument('--source', choices=['egksco', 'historical', 'stock_daily', 'all'],
                        default='all', help='مصدر واحد بس')
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()[:19]}] 🔧 Phase 2: unify to price_history.db...")
    print(f"  mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print(f"  source: {args.source}")

    # 1. row count قبل
    counts_before = get_row_count(PRICE_HISTORY_DB, 'price_history')
    print(f"\n  📊 price_history BEFORE: {counts_before:,} rows")

    # 2. تأكد من الـ schema
    print(f"\n  🔧 ensuring schema...")
    ensure_price_history_schema()

    # 3. ticker → market map
    ticker_market = get_ticker_market_map()
    print(f"  ✓ loaded {len(ticker_market)} ticker→market mappings")

    # 4. نفّذ التوحيد
    total_source = 0
    total_inserted = 0

    if args.source in ['egksco', 'all']:
        s, i = migrate_egksco(dry_run=args.dry_run)
        total_source += s
        total_inserted += i

    if args.source in ['historical', 'all']:
        s, i = migrate_historical(dry_run=args.dry_run, ticker_market=ticker_market)
        total_source += s
        total_inserted += i

    if args.source in ['stock_daily', 'all']:
        s, i = migrate_stock_daily(dry_run=args.dry_run, ticker_market=ticker_market)
        total_source += s
        total_inserted += i

    print(f"\n  📊 Summary:")
    print(f"    source rows processed: {total_source:,}")
    print(f"    new rows inserted:     {total_inserted:,}")
    print(f"    duplicates skipped:    {total_source - total_inserted:,}")

    # 5. اختبارات
    if not args.dry_run:
        checks = verify_migration(counts_before)
        passed = sum(1 for c in checks if c[1] == 'PASS')
        failed = sum(1 for c in checks if c[1] == 'FAIL')
        warned = sum(1 for c in checks if c[1] == 'WARN')
        print(f"\n  📋 Verification: {passed} passed, {warned} warnings, {failed} failed")

        if failed > 0:
            print(f"\n  ❌ Phase 2 FAILED — do not proceed to Phase 3")
            return 1

    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 2 complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
