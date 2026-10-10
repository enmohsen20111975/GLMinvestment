#!/usr/bin/env python3
"""
backfill_from_stocks_db.py — ملء فجوة price_history.db من stock_daily_prices
============================================================================

المشكلة:
- yfinance بيرجّع empty لكل أسهم EGX (475 فشل)
- price_history.db فيه فجوة 3+ أشهر
- الشارت المحلي بيظهر مشوّه بسبب الفجوة

الحل:
- نسخ البيانات من stocks.db.stock_daily_prices → price_history.db.price_history
- stock_daily_prices فيها أسعار يومية محدّثة من egksco_scraper
- بيكتب بس الصفوف اللي مش موجودة (INSERT OR IGNORE)

Usage:
  cd /root/GLMinvestment
  python3 scripts/backfill_from_stocks_db.py
  python3 scripts/backfill_from_stocks_db.py --ticker NIPH
  python3 scripts/backfill_from_stocks_db.py --dry-run
"""

import sqlite3
import sys
import os
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1] if Path(__file__).parent.name == 'scripts' else Path(__file__).resolve().parents[2]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'

DRY_RUN = '--dry-run' in sys.argv
TICKER_FILTER = None
for arg in sys.argv[1:]:
    if arg.startswith('--ticker='):
        TICKER_FILTER = arg.split('=')[1].upper()
    elif arg == '--ticker' and sys.argv.index(arg) + 1 < len(sys.argv):
        TICKER_FILTER = sys.argv[sys.argv.index(arg) + 1].upper()


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%H:%M:%S')
    print(f'[{ts}] [{level}] {msg}', flush=True)


def main():
    log('=' * 60)
    log('  📊 Backfill price_history.db من stock_daily_prices')
    log('=' * 60)

    if not STOCKS_DB.exists():
        log(f'❌ stocks.db غير موجود: {STOCKS_DB}', 'ERROR')
        return
    if not PRICE_HISTORY_DB.exists():
        log(f'❌ price_history.db غير موجود: {PRICE_HISTORY_DB}', 'ERROR')
        return

    # 1. فتح DBs مع WAL + busy_timeout
    stocks_conn = sqlite3.connect(str(STOCKS_DB), timeout=30)
    stocks_conn.execute("PRAGMA journal_mode=WAL")
    stocks_conn.execute("PRAGMA busy_timeout=30000")
    stocks_conn.row_factory = sqlite3.Row

    ph_conn = sqlite3.connect(str(PRICE_HISTORY_DB), timeout=30)
    ph_conn.execute("PRAGMA journal_mode=WAL")
    ph_conn.execute("PRAGMA busy_timeout=30000")

    # 2. جلب التيكرز
    if TICKER_FILTER:
        tickers = [TICKER_FILTER]
        log(f'  تيكر محدد: {TICKER_FILTER}')
    else:
        rows = stocks_conn.execute("SELECT DISTINCT ticker FROM stock_daily_prices WHERE ticker IS NOT NULL").fetchall()
        tickers = [r['ticker'] for r in rows if r['ticker']]
        log(f'  عدد التيكرز: {len(tickers)}')

    total_inserted = 0
    total_skipped = 0
    failed = 0

    for i, ticker in enumerate(tickers):
        if i % 50 == 0:
            log(f'  المعالجة: {i}/{len(tickers)}...')

        try:
            # جلب كل أسعار السهم من stock_daily_prices
            rows = stocks_conn.execute("""
                SELECT ticker, price_date as date, open, high, low, close, volume, change_percent
                FROM stock_daily_prices
                WHERE ticker = ? AND close IS NOT NULL AND close > 0
                ORDER BY price_date ASC
            """, (ticker,)).fetchall()

            if not rows:
                total_skipped += 1
                continue

            inserted = 0
            for r in rows:
                if DRY_RUN:
                    inserted += 1
                    continue

                # INSERT OR IGNORE (لو الصف موجود → skip)
                try:
                    ph_conn.execute("""
                        INSERT OR IGNORE INTO price_history
                            (ticker, date, open_price, high_price, low_price, close_price, volume, source, created_at, adjusted, market)
                        VALUES (?, ?, ?, ?, ?, ?, ?, 'stocks_db_backfill', datetime('now'), 1, 'EGX')
                    """, (
                        r['ticker'], r['date'],
                        float(r['open']) if r['open'] else None,
                        float(r['high']) if r['high'] else None,
                        float(r['low']) if r['low'] else None,
                        float(r['close']),
                        int(r['volume']) if r['volume'] and str(r['volume']).replace('.','').replace(',','').isdigit() else None,
                    ))
                    if ph_conn.total_changes > 0:
                        inserted += 1
                except Exception:
                    pass

            total_inserted += inserted
            if inserted == 0:
                total_skipped += 1

        except Exception as e:
            failed += 1
            if failed <= 3:
                log(f'  ⚠️ {ticker}: {e}')

    if not DRY_RUN:
        ph_conn.commit()

    # 3. تقرير
    log('')
    log('=' * 60)
    log('  📋 RESULT')
    log('=' * 60)
    log(f'  Tickers processed : {len(tickers)}')
    log(f'  Rows inserted     : {total_inserted}')
    log(f'  Tickers skipped   : {total_skipped}')
    log(f'  Tickers failed    : {failed}')
    if not DRY_RUN:
        # MAX date بعد التحديث
        max_date = ph_conn.execute("SELECT MAX(date) FROM price_history").fetchone()[0]
        total_rows = ph_conn.execute("SELECT COUNT(*) FROM price_history").fetchone()[0]
        log(f'  MAX(date) after  : {max_date}')
        log(f'  Total rows        : {total_rows}')

    stocks_conn.close()
    ph_conn.close()
    log('')
    log('✅ اكتمل')


if __name__ == '__main__':
    main()
