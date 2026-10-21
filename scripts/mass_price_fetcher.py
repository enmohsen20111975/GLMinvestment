#!/usr/bin/env python3
"""
scripts/mass_price_fetcher.py
==============================
Task 3: محرك جلب الأسعار الشامل (Mass Price Fetcher).

يجلب أسعار الأسهم المتجمدة (stale) من yfinance + scrapers محلية.

Usage:
    python3 scripts/mass_price_fetcher.py --dry-run
    python3 scripts/mass_price_fetcher.py --ticker COMI
    python3 scripts/mass_price_fetcher.py  # full run
"""
import sqlite3
import argparse
import sys
import time
from pathlib import Path
from datetime import datetime, timedelta

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'

STALE_DATE = '2026-10-20'  # anything before this is stale


def get_stale_tickers():
    """احصل على قائمة الأسهم المتجمدة."""
    conn = sqlite3.connect(f"file:{STOCKS_DB}?mode=ro", uri=True)
    rows = conn.execute("""
        SELECT ticker, market, current_price, last_update
        FROM stocks
        WHERE is_active = 1
        AND (last_update < ? OR last_update IS NULL)
        ORDER BY market, ticker
    """, (STALE_DATE,)).fetchall()
    conn.close()
    return rows


def fetch_yfinance(ticker, market):
    """جلب سعر من yfinance (للأسهم العالمية + US)."""
    try:
        import yfinance as yf
        # Map tickers for yfinance
        yf_ticker = ticker
        if market == 'US':
            yf_ticker = ticker
        elif market == 'TADAWUL':
            yf_ticker = f"{ticker}.SR"
        elif market == 'KSE':
            yf_ticker = f"{ticker}.KW"
        elif market == 'QSE':
            yf_ticker = f"{ticker}.QA"

        t = yf.Ticker(yf_ticker)
        hist = t.history(period="5d")
        if hist.empty:
            return None

        latest = hist.iloc[-1]
        return {
            'price': round(float(latest['Close']), 4),
            'open': round(float(latest['Open']), 4),
            'high': round(float(latest['High']), 4),
            'low': round(float(latest['Low']), 4),
            'volume': int(latest['Volume']),
            'date': str(hist.index[-1].date()),
        }
    except Exception as e:
        return None


def fetch_from_price_history(ticker):
    """جلب آخر سعر من price_history.db (fallback محلي)."""
    if not PRICE_HISTORY_DB.exists():
        return None
    try:
        conn = sqlite3.connect(f"file:{PRICE_HISTORY_DB}?mode=ro", uri=True)
        row = conn.execute("""
            SELECT date, open_price, high_price, low_price, close_price, volume
            FROM price_history
            WHERE ticker = ? AND close_price > 0
            ORDER BY date DESC LIMIT 1
        """, (ticker,)).fetchone()
        conn.close()
        if row:
            return {
                'price': float(row[4]),
                'open': float(row[1]),
                'high': float(row[2]),
                'low': float(row[3]),
                'volume': int(row[5] or 0),
                'date': row[0],
            }
    except:
        pass
    return None


def update_stock_price(ticker, price_data):
    """حدث سعر السهم في stocks.db."""
    conn = sqlite3.connect(str(STOCKS_DB), timeout=30.0)
    cur = conn.cursor()

    # update stocks table
    cur.execute("""
        UPDATE stocks SET
            current_price = ?,
            last_update = ?
        WHERE ticker = ?
    """, (price_data['price'], datetime.now().isoformat(), ticker))

    # insert into stock_daily_prices (if not exists for this date)
    existing = cur.execute("""
        SELECT COUNT(*) FROM stock_daily_prices
        WHERE ticker = ? AND price_date = ?
    """, (ticker, price_data['date'])).fetchone()[0]

    if existing == 0:
        cur.execute("""
            INSERT INTO stock_daily_prices (ticker, price_date, open, high, low, close, volume)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        """, (ticker, price_data['date'], price_data['open'],
              price_data['high'], price_data['low'], price_data['price'],
              price_data['volume']))

    conn.commit()
    conn.close()


def main():
    parser = argparse.ArgumentParser(description='Mass Price Fetcher')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط')
    parser.add_argument('--ticker', type=str, help='اختبار سهم واحد')
    args = parser.parse_args()

    print("=" * 60)
    print("💰 Task 3: Mass Price Fetcher")
    print(f"   DB: {STOCKS_DB}")
    print(f"   Mode: {'DRY RUN' if args.dry_run else 'LIVE'}")
    print("=" * 60)

    if args.ticker:
        # single ticker test
        tickers = [(args.ticker, 'EGX', 0, None)]
    else:
        tickers = get_stale_tickers()

    print(f"\n  Stale stocks to fetch: {len(tickers)}")

    success = 0
    failed = 0
    skipped = 0

    for i, (ticker, market, old_price, last_update) in enumerate(tickers):
        print(f"\n  [{i+1}/{len(tickers)}] {ticker} ({market})...")

        # Try yfinance first (for US/TADAWUL/KSE/QSE)
        price_data = None
        if market in ('US', 'TADAWUL', 'KSE', 'QSE'):
            price_data = fetch_yfinance(ticker, market)

        # Fallback: price_history.db
        if not price_data:
            price_data = fetch_from_price_history(ticker)

        if price_data:
            print(f"    ✅ price={price_data['price']} date={price_data['date']}")
            if not args.dry_run:
                update_stock_price(ticker, price_data)
            success += 1
        else:
            print(f"    ❌ No data available (delisted or unsupported)")
            failed += 1

        # Rate limit (don't get blocked)
        if not args.dry_run and market in ('US', 'TADAWUL', 'KSE', 'QSE'):
            time.sleep(1)

    # Summary
    print(f"\n{'='*60}")
    print(f"📊 Report")
    print(f"{'='*60}")
    print(f"  Success: {success}")
    print(f"  Failed: {failed}")
    print(f"  Skipped: {skipped}")
    print(f"  Total: {len(tickers)}")

    if not args.dry_run:
        # verify stale count after
        remaining = get_stale_tickers()
        print(f"  Remaining stale: {len(remaining)}")

    print(f"\n✅ Task 3 complete" if not args.dry_run else f"\n[DRY RUN] Task 3 preview complete")
    return 0


if __name__ == "__main__":
    exit(main())
