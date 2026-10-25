#!/usr/bin/env python3
"""
=============================================================================
🔧 sync_historical_data.py — تحديث historical_data من المصادر الطازجة
=============================================================================

المشكلة: maker_radar.py بيقرا historical_data للأسواق الخليجية، بس
historical_data متجمد منذ يونيو 2026. النتيجة: كل التحليلات بتعتمد
على بيانات 4 شهور قديمة، فبتطلع إشارات الماضي مش الحاضر.

الحل: السكربت ده بياخد آخر الأسعار من:
  - stocks.db.stock_daily_prices (طازج — Oct 21)
  - price_history.db.price_history (طازج — Oct 21)

ويكتبها في data_engine.db.historical_data (اللي متجمد يونيو).

بكده المحركات (maker_radar, daily_predictor) لما تقرا historical_data
هتلاقي بيانات طازة مش يونيو.

Usage:
    python3 scripts/sync_historical_data.py
    python3 scripts/sync_historical_data.py --dry-run
    python3 scripts/sync_historical_data.py --days 30  # آخر 30 يوم بس
=============================================================================
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'


def main():
    parser = argparse.ArgumentParser(description='Sync historical_data from fresh sources')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط')
    parser.add_argument('--days', type=int, default=60, help='عدد الأيام الأخيرة للمزامنة (default: 60)')
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()[:19]}] 🔧 sync_historical_data starting...")
    print(f"  will sync last {args.days} days from stock_daily_prices + price_history → historical_data")

    # 1. اقرا ticker → market map
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    sconn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    ticker_market = {r[0]: r[1] for r in sconn.execute("SELECT ticker, market FROM stocks WHERE is_active=1")}
    ticker_names = {r[0]: r[1] for r in sconn.execute("SELECT ticker, name_ar FROM stocks")}
    sconn.close()
    print(f"  ✓ loaded {len(ticker_market)} active tickers")

    # 2. تحديد التاريخ الأقصى الموجود في historical_data
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    deconn = db_manager.connection(str(DATA_ENGINE_DB), writable=False).__enter__()
    cur = deconn.cursor()

    # schema: historical_data(id, symbol, name, market, date, open, high, low, close, volume, ...)
    # تأكد إن الأعمدة موجودة
    cols = [c[1] for c in cur.execute("PRAGMA table_info(historical_data)").fetchall()]
    print(f"  historical_data columns: {cols[:12]}")

    # آخر تاريخ لكل سوق
    print(f"\n  === historical_data BEFORE sync ===")
    for mkt, latest, cnt in cur.execute("SELECT market, MAX(date), COUNT(*) FROM historical_data GROUP BY market ORDER BY market").fetchall():
        print(f"    {mkt:15s}: latest={latest} | {cnt:,} rows")

    # 3. اجمع البيانات الطازجة من stock_daily_prices
    cutoff_date = (datetime.now() - timedelta(days=args.days)).strftime('%Y-%m-%d')
    print(f"\n  fetching rows from stock_daily_prices (since {cutoff_date})...")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    sconn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    sdp_rows = sconn.execute("""
        SELECT ticker, price_date,
               COALESCE(open, open_price), COALESCE(high, high_price),
               COALESCE(low, low_price), COALESCE(close, close_price), volume
        FROM stock_daily_prices
        WHERE price_date >= ? AND COALESCE(close, close_price) > 0
        ORDER BY ticker, price_date
    """, (cutoff_date,)).fetchall()
    sconn.close()
    print(f"  ✓ loaded {len(sdp_rows):,} rows from stock_daily_prices")

    # 4. اجمع من price_history.db (للي مش في stock_daily_prices)
    ph_rows = []
    if PRICE_HISTORY_DB.exists():
        print(f"  fetching from price_history.db (since {cutoff_date})...")
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        pconn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        # بس tickers مش موجودة في stock_daily_prices
        sdp_tickers = set(r[0] for r in sdp_rows)
        ph_rows = pconn.execute("""
            SELECT ticker, date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE date >= ? AND close_price > 0
            ORDER BY ticker, date
        """, (cutoff_date,)).fetchall()
        pconn.close()
        # فلتر اللي مش في sdp
        ph_rows = [r for r in ph_rows if r[0] not in sdp_tickers]
        print(f"  ✓ loaded {len(ph_rows):,} additional rows from price_history.db")

    # 5. اكتب في historical_data (UPSERT)
    total_upserted = 0
    if not args.dry_run:
        # تأكد من وجود UNIQUE constraint أو index
        # historical_data schema: (id, symbol, name, market, date, open, high, low, close, volume, last_fetch, close_price, ticker, change_percent)
        # نستخدم INSERT OR REPLACE على (symbol, date)
        # بس لو مفيش UNIQUE، نستخدم DELETE + INSERT

        for ticker, date, op, hp, lp, cp, vol in sdp_rows:
            market = ticker_market.get(ticker, 'EGX')
            name = ticker_names.get(ticker, ticker)
            try:
                cur.execute("""
                    INSERT OR REPLACE INTO historical_data
                    (symbol, name, market, date, open, high, low, close, volume, last_fetch, ticker)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ticker, name, market, date, op, hp, lp, cp, vol or 0,
                      datetime.now().isoformat(), ticker))
                total_upserted += 1
            except Exception as e:
                pass

        for ticker, date, op, hp, lp, cp, vol in ph_rows:
            market = ticker_market.get(ticker, 'EGX')
            name = ticker_names.get(ticker, ticker)
            try:
                cur.execute("""
                    INSERT OR REPLACE INTO historical_data
                    (symbol, name, market, date, open, high, low, close, volume, last_fetch, ticker)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (ticker, name, market, date, op, hp, lp, cp, vol or 0,
                      datetime.now().isoformat(), ticker))
                total_upserted += 1
            except Exception:
                pass

        deconn.commit()
        print(f"\n  ✅ upserted {total_upserted:,} rows into historical_data")
    else:
        total_possible = len(sdp_rows) + len(ph_rows)
        print(f"\n  [DRY RUN] would upsert {total_possible:,} rows")

    # 6. عرض النتيجة بعد المزامنة
    print(f"\n  === historical_data AFTER sync ===")
    for mkt, latest, cnt in cur.execute("SELECT market, MAX(date), COUNT(*) FROM historical_data GROUP BY market ORDER BY market").fetchall():
        print(f"    {mkt:15s}: latest={latest} | {cnt:,} rows")

    deconn.close()
    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
