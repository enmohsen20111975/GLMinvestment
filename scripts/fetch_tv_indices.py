#!/usr/bin/env python3
"""
fetch_tv_indices.py — سحب القيم الرسمية للمؤشرات من TradingView
====================================================================
Owner directive (2026-10-29): "بنحسب المؤشرات غلط — لازم نسحبها من TV"

بدل ما نحسب المؤشرات محلي (خطأ)، نسحب القيم الرسمية مباشرة من صفحات
TradingView symbol pages لكل الأسواق.

المصدر: https://ar.tradingview.com/symbols/{EXCHANGE}-{SYMBOL}/
الطريقة: scrape صفحة HTML → استخرج daily_bar_close + change

الأسواق المغطاة:
  - EGX: EGX30, EGX70EWI, EGX100EWI, TAMAYUZ
  - TADAWUL: TASI
  - QSE: QEAS (Qatar All Share)
  - US: SPX (S&P 500), NDX (Nasdaq 100), DJI (Dow Jones)

Usage:
    python3 scripts/fetch_tv_indices.py              # سحب كل المؤشرات
    python3 scripts/fetch_tv_indices.py --dry-run    # عرض فقط بدون حفظ
"""
import urllib.request
import sqlite3
import argparse
import re
import sys
import time
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'

# المؤشرات الرسمية من TradingView
# (db_symbol, name_ar, tv_exchange, tv_symbol, url_slug)
INDICES = [
    # EGX
    ('EGX30', 'مؤشر إيجى إكس 30', 'EGX', 'EGX30', 'EGX-EGX30'),
    ('EGX70', 'مؤشر إيجى إكس 70 متساوي الأوزان', 'EGX', 'EGX70EWI', 'EGX-EGX70EWI'),
    ('EGX100', 'مؤشر إيجى إكس 100 متساوي الأوزان', 'EGX', 'EGX100EWI', 'EGX-EGX100EWI'),
    ('TAMAYUZ', 'مؤشر تميز', 'EGX', 'TAMAYUZ', 'EGX-TAMAYUZ'),
    # TADAWUL
    ('TADAWUL_TASI', 'مؤشر تاسي', 'TADAWUL', 'TASI', 'TADAWUL-TASI'),
    # QSE
    ('QSE_QEAS', 'مؤشر بورصة قطر لجميع الأسهم', 'QSE', 'QEAS', 'QSE-QEAS'),
    # US
    ('US_SP500', 'مؤشر S&P 500', 'SP', 'SPX', 'SP-SPX'),
    ('US_NASDAQ100', 'مؤشر ناسداك 100', 'NASDAQ', 'NDX', 'NASDAQ-NDX'),
    ('US_DOWJONES', 'مؤشر داو جونز', 'DJ', 'DJI', 'DJ-DJI'),
]

USER_AGENT = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36'


def fetch_index_page(slug: str):
    """اسحب صفحة مؤشر من TradingView و استخرج القيمة + التغيير.

    Returns:
        (close, change_percent, high, low, open) أو (None, None, None, None, None)
    """
    url = f"https://ar.tradingview.com/symbols/{slug}/"
    req = urllib.request.Request(url, headers={
        'User-Agent': USER_AGENT,
        'Accept': 'text/html,application/xhtml+xml',
        'Accept-Language': 'ar,en;q=0.9',
    }, method='GET')
    try:
        with urllib.request.urlopen(req, timeout=15) as resp:
            html = resp.read().decode('utf-8', errors='replace')
    except Exception as e:
        print(f"  ❌ fetch error for {slug}: {e}")
        return None, None, None, None, None

    # Pattern 1: daily_bar_close (some pages)
    close = None
    match = re.search(r'"name":"daily_bar_close","source":"[^"]*","value":([\d.]+)', html)
    if match:
        close = float(match.group(1))

    # Pattern 2: "close":"value" (other pages)
    if close is None:
        match2 = re.search(r'"close":"([\d.]+)"', html)
        if match2:
            close = float(match2.group(1))

    # Pattern 3: JSON-LD offer price
    if close is None:
        match3 = re.search(r'"@type":"Offer","price":"([\d.]+)"', html)
        if match3:
            close = float(match3.group(1))

    if close is None:
        return None, None, None, None, None

    # Extract change percent
    change_pct = None
    chg_match = re.search(r'"changes?":\s*(-?[\d.]+)', html)
    if chg_match:
        change_pct = float(chg_match.group(1))

    # Extract high/low/open from JSON data
    high = low = open_p = None
    h_match = re.search(r'"high":"([\d.]+)"', html)
    if h_match: high = float(h_match.group(1))
    l_match = re.search(r'"low":"([\d.]+)"', html)
    if l_match: low = float(l_match.group(1))
    o_match = re.search(r'"open":"([\d.]+)"', html)
    if o_match: open_p = float(o_match.group(1))

    return close, change_pct, high, low, open_p


def upsert_index(conn, symbol, name_ar, close, change_pct, high, low):
    """UPSERT المؤشر في market_indices (يكتب في value + current_value)."""
    now_iso = datetime.now().isoformat()
    # previous_close = close - change (لو عندنا change)
    previous_close = None
    change_val = None
    if change_pct is not None and close:
        # change_pct = (close - prev) / prev * 100
        # prev = close / (1 + change_pct/100)
        previous_close = round(close / (1 + change_pct / 100), 2) if change_pct != 0 else close
        change_val = round(close - previous_close, 2)

    conn.execute("""
        INSERT INTO market_indices
        (symbol, name, name_ar, current_value, value, previous_close, change, change_percent,
         high, low, last_update, source)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(symbol) DO UPDATE SET
            current_value = excluded.current_value,
            value = excluded.value,
            previous_close = COALESCE(excluded.previous_close, market_indices.previous_close),
            change = COALESCE(excluded.change, market_indices.change),
            change_percent = COALESCE(excluded.change_percent, market_indices.change_percent),
            high = COALESCE(excluded.high, market_indices.high),
            low = COALESCE(excluded.low, market_indices.low),
            last_update = excluded.last_update,
            source = excluded.source
    """, (
        symbol, name_ar, name_ar,
        close, close,  # value = current_value
        previous_close, change_val, change_pct,
        high, low, now_iso, 'tradingview_official'
    ))


def main():
    parser = argparse.ArgumentParser(description='Fetch official index values from TradingView')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون حفظ')
    args = parser.parse_args()

    print("=" * 60)
    print("  Fetch TV Official Indices — TradingView symbol pages")
    print("=" * 60)
    print(f"  Time: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"  Mode: {'DRY-RUN' if args.dry_run else 'LIVE'}")
    print()

    conn = None
    if not args.dry_run:
        conn = sqlite3.connect(str(STOCKS_DB))
        conn.execute('PRAGMA busy_timeout = 30000')

    fetched = 0
    failed = 0

    for db_sym, name_ar, exchange, tv_sym, slug in INDICES:
        print(f"  📡 {exchange:8} {db_sym:15} ({slug})...", end=' ', flush=True)
        close, change_pct, high, low, open_p = fetch_index_page(slug)

        if close is not None:
            print(f"✅ close={close:>12.2f} change={change_pct or 0:+.2f}%")
            if not args.dry_run:
                upsert_index(conn, db_sym, name_ar, close, change_pct, high, low)
            fetched += 1
        else:
            print("❌ no data")
            failed += 1

        time.sleep(2)  # rate limit (آمن — لا حظر)

    if conn and not args.dry_run:
        conn.commit()

        # Also persist to index_daily_prices (time-series)
        today = datetime.now().strftime('%Y-%m-%d')
        for db_sym, name_ar, exchange, tv_sym, slug in INDICES:
            row = conn.execute(
                'SELECT current_value, change_percent, high, low FROM market_indices WHERE symbol = ?',
                (db_sym,)
            ).fetchone()
            if row and row[0]:
                conn.execute("""
                    INSERT OR REPLACE INTO index_daily_prices
                    (symbol, price_date, close, high, low, change_percent)
                    VALUES (?, ?, ?, ?, ?, ?)
                """, (db_sym, today, row[0], row[2] or row[0], row[3] or row[0], row[1] or 0))
        conn.commit()
        conn.close()

    print()
    print("=" * 60)
    print(f"  ✅ Fetched: {fetched}/{len(INDICES)} | ❌ Failed: {failed}")
    if not args.dry_run:
        print(f"  💾 Saved to market_indices + index_daily_prices")
    print("=" * 60)
    return 0 if failed == 0 else 1


if __name__ == '__main__':
    sys.exit(main())
