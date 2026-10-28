#!/usr/bin/env python3
"""
sync_missing_prices.py — UPSERT الأسعار الناقصة من data_engine.db لـ stocks.db
==============================================================================
المرحلة 1: نسخ الأسعار اللي ناقصة بس (مش كل الـ 197K صف).

الـ strategy:
  1. لكل ticker، شوف آخر تاريخ في stock_daily_prices (stocks.db)
  2. لو فيه أسعار أحدث في data_engine.db → UPSERTها
  3. لو مفيش أي تاريخ في stocks.db → انسخ آخر 60 يوم بس (مش كل التاريخ)

المصادر (بالترتيب):
  1. egksco_price_history (EGX فقط — المصدر الرسمي المصري)
  2. historical_data (كل الأسواق — Yahoo + مصادر)

التعارض: لو نفس (ticker, date) موجود في الاتنين، نختار egksco (المصدر الرسمي).

Usage:
    python3 scripts/sync_missing_prices.py                    # default
    python3 scripts/sync_missing_prices.py --dry-run           # report only
    python3 scripts/sync_missing_prices.py --market EGX        # سوق واحد
    python3 scripts/sync_missing_prices.py --days 7           # آخر 7 أيام
"""
import sqlite3
import argparse
import sys
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DATA_ENGINE_DB = PROJECT_ROOT / 'db' / 'data_engine.db'


def get_stocks_db_connection():
    """افتح stocks.db للكتابة."""
    conn = sqlite3.connect(str(STOCKS_DB))
    conn.execute('PRAGMA journal_mode = WAL')
    conn.execute('PRAGMA busy_timeout = 30000')
    # تأكد إن الجدول موجود + الـ UNIQUE index
    conn.execute('''
        CREATE TABLE IF NOT EXISTS stock_daily_prices (
            ticker TEXT,
            price_date TEXT,
            open REAL,
            high REAL,
            low REAL,
            close REAL,
            volume REAL,
            change_percent REAL,
            fetch_time TEXT,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            turnover REAL,
            market TEXT
        )
    ''')
    # UNIQUE index عشان الـ UPSERT يشتغل
    try:
        conn.execute('CREATE UNIQUE INDEX IF NOT EXISTS idx_sdp_ticker_date ON stock_daily_prices(ticker, price_date)')
    except Exception:
        pass  # ممكن يكون موجود بالفعل
    return conn


def get_data_engine_connection():
    """افتح data_engine.db للقراءة."""
    return sqlite3.connect(str(DATA_ENGINE_DB), timeout=30.0)


def get_tickers_to_sync(market_filter: str = None):
    """كل الأسهم اللي محتاجين sync. لو market_filter محدد، فلتر بالسوق."""
    stocks_conn = sqlite3.connect(str(STOCKS_DB))
    if market_filter:
        rows = stocks_conn.execute(
            'SELECT ticker, market FROM stocks WHERE market = ? AND is_active = 1 AND current_price > 0',
            (market_filter,)
        ).fetchall()
    else:
        rows = stocks_conn.execute(
            'SELECT ticker, market FROM stocks WHERE is_active = 1 AND current_price > 0'
        ).fetchall()
    stocks_conn.close()
    return rows


def get_last_date_in_stocks_db(stocks_conn, ticker):
    """آخر تاريخ في stock_daily_prices لهذا الـ ticker."""
    row = stocks_conn.execute(
        'SELECT MAX(price_date) FROM stock_daily_prices WHERE ticker = ?',
        (ticker,)
    ).fetchone()
    return row[0] if row and row[0] else None


def get_missing_prices_from_egksco(de_conn, ticker, last_date, days_limit=60):
    """الأسعار الناقصة من egksco_price_history (EGX فقط).

    INDICATORS-FIX (2026-10-28): بـ نجيب كل الأسعار من egksco (مش بس الأحدث من last_date)
    عشان نـ fix الأسعار الـ flat الغلط في stocks.db. egksco هو المصدر الرسمي المصري
    → قيمته تـ override أي قيمة flat في stocks.db.
    """
    if last_date:
        # كل الأسعار من egksco (للـ flat-fix) — مش بس الأحدث
        rows = de_conn.execute(
            '''SELECT symbol, price_date, open_price, high_price, low_price,
                      close_price, volume
               FROM egksco_price_history
               WHERE symbol = ?
               ORDER BY price_date ASC''',
            (ticker,)
        ).fetchall()
    else:
        rows = de_conn.execute(
            '''SELECT symbol, price_date, open_price, high_price, low_price,
                      close_price, volume
               FROM egksco_price_history
               WHERE symbol = ?
               ORDER BY price_date DESC LIMIT ?''',
            (ticker, days_limit)
        ).fetchall()
        rows = list(reversed(rows))
    return rows


def get_missing_prices_from_historical(de_conn, ticker, market, last_date, days_limit=60):
    """الأسعار الناقصة من historical_data (كل الأسواق)."""
    if last_date:
        # كل الأسعار (للـ flat-fix) — مش بس الأحدث
        rows = de_conn.execute(
            '''SELECT symbol, date, open, high, low, close, volume
               FROM historical_data
               WHERE symbol = ?
               ORDER BY date ASC''',
            (ticker,)
        ).fetchall()
    else:
        rows = de_conn.execute(
            '''SELECT symbol, date, open, high, low, close, volume
               FROM historical_data
               WHERE symbol = ?
               ORDER BY date DESC LIMIT ?''',
            (ticker, days_limit)
        ).fetchall()
        rows = list(reversed(rows))
    return rows


def upsert_price_row(stocks_conn, ticker, price_date, open_p, high_p, low_p,
                     close_p, volume, change_pct, market, source='historical'):
    """UPSERT صف واحد في stock_daily_prices (بترتيب الأعمدة الصح).

    INDICATORS-FIX (2026-10-28): لو source='egksco' (المصدر الرسمي المصري)
    → نـ override الأسعار الموجودة (مش بس COALESCE). ده ضروري عشان نـ fix
    الأسعار الـ flat الغلط في stocks.db. لو source='historical' → COALESCE بس
    (لا نـ override قيم موجودة من مصدر أحسن).
    """
    def safe_num(v):
        if v is None: return None
        try: return float(v)
        except (ValueError, TypeError): return None

    open_p = safe_num(open_p)
    high_p = safe_num(high_p)
    low_p = safe_num(low_p)
    close_p = safe_num(close_p)
    volume = safe_num(volume)
    change_pct = safe_num(change_pct)

    if close_p is None:
        return False

    now_str = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    try:
        if source == 'egksco':
            # egksco = المصدر الرسمي → override القيم الموجودة
            stocks_conn.execute(
                '''INSERT INTO stock_daily_prices
                   (ticker, price_date, open, high, low, close, close_price,
                    volume, change_percent, market, fetch_time, open_price, high_price, low_price)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(ticker, price_date) DO UPDATE SET
                    open = excluded.open,
                    high = excluded.high,
                    low = excluded.low,
                    close = excluded.close,
                    close_price = excluded.close_price,
                    volume = CASE WHEN excluded.volume > 0 THEN excluded.volume ELSE stock_daily_prices.volume END,
                    change_percent = CASE WHEN excluded.change_percent IS NOT NULL THEN excluded.change_percent ELSE stock_daily_prices.change_percent END,
                    market = COALESCE(excluded.market, stock_daily_prices.market),
                    fetch_time = excluded.fetch_time,
                    open_price = excluded.open_price,
                    high_price = excluded.high_price,
                    low_price = excluded.low_price
                ''',
                (ticker, price_date, open_p, high_p, low_p, close_p, close_p,
                 volume, change_pct, market, now_str, open_p, high_p, low_p)
            )
        else:
            # historical → COALESCE بس (لا override)
            stocks_conn.execute(
                '''INSERT INTO stock_daily_prices
                   (ticker, price_date, open, high, low, close, close_price,
                    volume, change_percent, market, fetch_time, open_price, high_price, low_price)
                   VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                   ON CONFLICT(ticker, price_date) DO UPDATE SET
                    open = COALESCE(excluded.open, stock_daily_prices.open),
                    high = COALESCE(excluded.high, stock_daily_prices.high),
                    low = COALESCE(excluded.low, stock_daily_prices.low),
                    close = COALESCE(excluded.close, stock_daily_prices.close),
                    close_price = COALESCE(excluded.close_price, stock_daily_prices.close_price),
                    volume = COALESCE(excluded.volume, stock_daily_prices.volume),
                    change_percent = COALESCE(excluded.change_percent, stock_daily_prices.change_percent),
                    market = COALESCE(excluded.market, stock_daily_prices.market),
                    fetch_time = excluded.fetch_time,
                    open_price = COALESCE(excluded.open_price, stock_daily_prices.open_price),
                    high_price = COALESCE(excluded.high_price, stock_daily_prices.high_price),
                    low_price = COALESCE(excluded.low_price, stock_daily_prices.low_price)
                ''',
                (ticker, price_date, open_p, high_p, low_p, close_p, close_p,
                 volume, change_pct, market, now_str, open_p, high_p, low_p)
            )
        return True
    except Exception as e:
        print(f'    ⚠️  UPSERT error for {ticker} @ {price_date}: {e}', flush=True)
        return False


def sync_market(market_filter: str = None, dry_run: bool = False, days_limit: int = 60):
    """شغّل الـ sync لسوق معين أو لكل الأسواق."""
    print(f'\n{"="*60}', flush=True)
    print(f'  Sync Missing Prices — data_engine.db → stocks.db', flush=True)
    print(f'  Market: {market_filter or "ALL"}', flush=True)
    print(f'  Dry-run: {dry_run}', flush=True)
    print(f'  Days limit: {days_limit}', flush=True)
    print(f'  Time: {datetime.now().strftime("%Y-%m-%d %H:%M:%S")}', flush=True)
    print(f'{"="*60}\n', flush=True)
    
    if not DATA_ENGINE_DB.exists():
        print(f'❌ data_engine.db مش موجود في: {DATA_ENGINE_DB}', flush=True)
        return
    
    if not STOCKS_DB.exists():
        print(f'❌ stocks.db مش موجود في: {STOCKS_DB}', flush=True)
        return
    
    tickers = get_tickers_to_sync(market_filter)
    print(f'📊 الأسهم المرشحة: {len(tickers)}', flush=True)
    
    if not tickers:
        print('ℹ️  مفيش أسهم نشطة', flush=True)
        return
    
    stocks_conn = get_stocks_db_connection()
    de_conn = get_data_engine_connection()
    
    total_upserted = 0
    total_skipped = 0
    total_errors = 0
    total_no_data = 0
    
    for i, (ticker, market) in enumerate(tickers):
        if i % 50 == 0:
            print(f'  ⏳ Processing {i+1}/{len(tickers)}...', flush=True)
        
        # 1. آخر تاريخ في stocks.db
        last_date = get_last_date_in_stocks_db(stocks_conn, ticker)
        
        # 2. الأسعار الناقصة من egksco (EGX فقط)
        egx_rows = []
        if market in ('EGX', 'مصر'):
            egx_rows = get_missing_prices_from_egksco(de_conn, ticker, last_date, days_limit)
        
        # 3. الأسعار الناقصة من historical_data (كل الأسواق)
        hist_rows = get_missing_prices_from_historical(de_conn, ticker, market, last_date, days_limit)
        
        # 4. ادمج (egksco أولوية + historical للناقص)
        all_dates = {}  # date → row
        for r in hist_rows:
            # historical_data: symbol, date, open, high, low, close, volume
            all_dates[r[1]] = {'source': 'historical', 'open': r[2], 'high': r[3], 'low': r[4], 'close': r[5], 'volume': r[6], 'change_pct': None}
        
        for r in egx_rows:
            # egksco_price_history: symbol, price_date, open_price, high_price, low_price, close_price, volume
            all_dates[r[1]] = {'source': 'egksco', 'open': r[2], 'high': r[3], 'low': r[4], 'close': r[5], 'volume': r[6], 'change_pct': None}
        
        if not all_dates:
            total_no_data += 1
            continue
        
        # 5. UPSERT كل صف
        upserted = 0
        for date_str, data in sorted(all_dates.items()):
            if dry_run:
                upserted += 1
                continue
            ok = upsert_price_row(
                stocks_conn, ticker, date_str,
                data['open'], data['high'], data['low'], data['close'],
                data['volume'], data['change_pct'], market,
                source=data['source']
            )
            if ok:
                upserted += 1
            else:
                total_errors += 1
        
        if upserted > 0:
            total_upserted += upserted
            print(f'  ✓ {ticker} ({market}): +{upserted} rows (last={last_date or "none"})', flush=True)
        else:
            total_skipped += 1
    
    # Commit
    if not dry_run:
        stocks_conn.commit()
    
    stocks_conn.close()
    de_conn.close()
    
    # ملخص
    print(f'\n{"="*60}', flush=True)
    print(f'  ✅ الملخص', flush=True)
    print(f'    - أسهم مت synchronised: {total_upserted} rows', flush=True)
    print(f'    - أسهم up to date (skip): {total_skipped}', flush=True)
    print(f'    - أسهم مفيهاش بيانات: {total_no_data}', flush=True)
    print(f'    - errors: {total_errors}', flush=True)
    print(f'{"="*60}', flush=True)


def main():
    parser = argparse.ArgumentParser(description='Sync missing prices from data_engine.db to stocks.db')
    parser.add_argument('--market', default=None,
                        choices=['EGX', 'TADAWUL', 'KSE', 'QSE', 'US', 'مصر', 'السعودية', 'الكويت', 'قطر'],
                        help='سوق واحد (default: all)')
    parser.add_argument('--dry-run', action='store_true',
                        help='report only — no DB writes')
    parser.add_argument('--days', type=int, default=60,
                        help='عدد الأيام للنسخ لو مفيش تاريخ (default: 60)')
    args = parser.parse_args()
    
    sync_market(args.market, args.dry_run, args.days)


if __name__ == '__main__':
    main()
