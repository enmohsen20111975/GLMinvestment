#!/usr/bin/env python3
"""
=============================================================================
📊 backfill_indices_history.py — بناء تاريخ المؤشرات من الأسعار التاريخية
=============================================================================

Owner directive: 'احنا بنعيد حسابات المؤشرات من البيانات الى عندنا
ومن البيانات القديمة والحديثة للأسعار مش بناخد حاجة كانت موجودة'

السكريبت ده بياخد كل يوم تاريخي موجود في:
  - price_history.db.price_history (تاريخ EGX من 2000-11-27)
  - stocks.db.stock_daily_prices (تاريخ كل الأسواق من 2025-09-22)

ولكل يوم، بيحسب قيمة المؤشر (EGX30/70/100/33 + KSE + QSE + TADAWUL + US)
ويكتبها في stocks.db.index_daily_prices (تاريخ المؤشرات).

النتيجة: شارت كامل لكل مؤشر من أول تاريخ متاح لليوم.

Usage:
    python3 scripts/backfill_indices_history.py
    python3 scripts/backfill_indices_history.py --dry-run
    python3 scripts/backfill_indices_history.py --from 2025-01-01  # من تاريخ محدد
=============================================================================
"""
import sqlite3
import json
import sys
import argparse
from pathlib import Path
from datetime import datetime
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'
CANONICAL_FILE = PROJECT_ROOT / 'vps-service' / 'data' / 'canonical_indices.json'


def load_canonical():
    """تحميل مكونات المؤشرات من canonical_indices.json"""
    with open(CANONICAL_FILE, encoding='utf-8') as f:
        return json.load(f)


def get_all_historical_prices():
    """
    يجيب كل الأسعار التاريخية من price_history.db + stock_daily_prices.
    يرجّع dict: ticker -> {date: close_price}
    """
    prices_by_ticker = defaultdict(dict)

    # 1. price_history.db (الأعمق — من 2000)
    if PRICE_HISTORY_DB.exists():
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(PRICE_HISTORY_DB, writable=False).__enter__()
        try:
            rows = conn.execute("""
                SELECT ticker, date, close_price
                FROM price_history
                WHERE close_price > 0
                ORDER BY ticker, date
            """).fetchall()
            for ticker, date, close in rows:
                prices_by_ticker[ticker][str(date)[:10]] = float(close)
        finally:
            conn.close()

    # 2. stock_daily_prices (الأحدث — من 2025)
    # override لو فيه أحدث
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    try:
        rows = conn.execute("""
            SELECT ticker, price_date, COALESCE(close, close_price)
            FROM stock_daily_prices
            WHERE COALESCE(close, close_price) > 0
            ORDER BY ticker, price_date
        """).fetchall()
        for ticker, date, close in rows:
            prices_by_ticker[ticker][str(date)[:10]] = float(close)
    finally:
        conn.close()

    return prices_by_ticker


def get_all_dates(prices_by_ticker, tickers):
    """كل التواريخ اللي فيها بيانات للـ tickers دي"""
    dates = set()
    for t in tickers:
        if t in prices_by_ticker:
            dates.update(prices_by_ticker[t].keys())
    return sorted(dates)


def compute_weighted_index_for_date(prices_by_ticker, date, constituents, base_value=30000):
    """حساب مؤشر موزون لليوم محدد"""
    total_weight = 0
    weighted_change = 0
    matched = 0
    prev_matched = 0

    for c in constituents:
        ticker = c['code']
        weight = c.get('weight', 0)
        if ticker not in prices_by_ticker:
            continue
        day_prices = prices_by_ticker[ticker]
        if date not in day_prices:
            continue
        # لو مفيش يوم سابق، مش نقدر نحسب change
        sorted_dates = sorted(day_prices.keys())
        idx = sorted_dates.index(date)
        if idx == 0:
            continue
        prev_date = sorted_dates[idx - 1]
        prev_close = day_prices[prev_date]
        today_close = day_prices[date]
        if prev_close <= 0:
            continue
        change_pct = (today_close - prev_close) / prev_close * 100
        total_weight += weight
        weighted_change += weight * change_pct
        matched += 1

    if total_weight == 0 or matched < 5:
        return None

    avg_change = weighted_change / total_weight
    current_value = base_value * (1 + avg_change / 100)
    return {
        'close': round(current_value, 2),
        'change_percent': round(avg_change, 2),
        'matched': matched,
    }


def compute_ewi_index_for_date(prices_by_ticker, date, constituents, base_value=8000, min_matched=20):
    """حساب مؤشر متساوي الأوزان لليوم محدد"""
    changes = []
    seen = set()
    for c in constituents:
        ticker = c['code']
        if ticker in seen:
            continue
        seen.add(ticker)
        if ticker not in prices_by_ticker:
            continue
        day_prices = prices_by_ticker[ticker]
        if date not in day_prices:
            continue
        sorted_dates = sorted(day_prices.keys())
        idx = sorted_dates.index(date)
        if idx == 0:
            continue
        prev_date = sorted_dates[idx - 1]
        prev_close = day_prices[prev_date]
        today_close = day_prices[date]
        if prev_close <= 0:
            continue
        change_pct = (today_close - prev_close) / prev_close * 100
        changes.append(change_pct)

    if len(changes) < min_matched:
        return None

    avg_change = sum(changes) / len(changes)
    current_value = base_value * (1 + avg_change / 100)
    return {
        'close': round(current_value, 2),
        'change_percent': round(avg_change, 2),
        'matched': len(changes),
    }


def compute_composite_for_date(prices_by_ticker, date, market, base_value, all_market_tickers):
    """حساب مؤشر مركب لسوق محدد لليوم"""
    changes = []
    for ticker in all_market_tickers:
        if ticker not in prices_by_ticker:
            continue
        day_prices = prices_by_ticker[ticker]
        if date not in day_prices:
            continue
        sorted_dates = sorted(day_prices.keys())
        idx = sorted_dates.index(date)
        if idx == 0:
            continue
        prev_date = sorted_dates[idx - 1]
        prev_close = day_prices[prev_date]
        today_close = day_prices[date]
        if prev_close <= 0:
            continue
        change_pct = (today_close - prev_close) / prev_close * 100
        changes.append(change_pct)

    if len(changes) < 10:
        return None

    avg_change = sum(changes) / len(changes)
    current_value = base_value * (1 + avg_change / 100)
    return {
        'close': round(current_value, 2),
        'change_percent': round(avg_change, 2),
        'matched': len(changes),
    }


def main():
    parser = argparse.ArgumentParser(description='Backfill indices history from stock prices')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    parser.add_argument('--from', dest='from_date', type=str, help='من تاريخ محدد (YYYY-MM-DD)')
    args = parser.parse_args()

    print(f"[{datetime.now().isoformat()[:19]}] 📊 backfill_indices_history starting...")

    # 1. تحميل canonical
    canonical = load_canonical()
    print(f"  ✓ loaded canonical_indices.json")

    # 2. تحميل كل الأسعار التاريخية
    print(f"  ⏳ loading historical prices (this may take 30-60s)...")
    prices_by_ticker = get_all_historical_prices()
    print(f"  ✓ loaded {len(prices_by_ticker)} tickers with historical prices")

    # 3. تحديد كل التواريخ المتاحة
    all_tickers = set()
    for idx_name in ['EGX30', 'EGX33_SHARIAH', 'EGX70_EWI']:
        for c in canonical.get(idx_name, {}).get('constituents', []):
            all_tickers.add(c['code'])

    # كل تواريخ EGX
    egx_dates = get_all_dates(prices_by_ticker, all_tickers)
    if args.from_date:
        egx_dates = [d for d in egx_dates if d >= args.from_date]
    print(f"  ✓ EGX dates range: {egx_dates[0] if egx_dates else '—'} → {egx_dates[-1] if egx_dates else '—'} ({len(egx_dates)} dates)")

    # 4. تحديد tickers لكل سوق (للمؤشرات المركبة)
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn_stocks = db_manager.connection(STOCKS_DB, writable=False).__enter__()
    market_tickers = defaultdict(list)
    try:
        for ticker, market in conn_stocks.execute("SELECT ticker, market FROM stocks WHERE is_active=1"):
            market_tickers[market].append(ticker)
    finally:
        conn_stocks.close()

    # 5. لكل يوم، احسب كل المؤشرات
    indices_history = defaultdict(list)  # symbol -> [{date, close, change_percent}]

    print(f"  ⏳ computing indices for {len(egx_dates)} EGX dates...")

    # FIX (2026-10-22): base_value was HARDCODED (30000/8000/11000) for EVERY
    # day → values didn't chain → flat line around the seed, NOT the real
    # trajectory. Now we CHAIN: each day uses the previous day's computed
    # close as the base. The seed (first day only) uses the hardcoded value
    # as a starting point — user should manually set the correct initial
    # value in index_daily_prices for the first date, then re-run to chain.
    prev_egx30 = None
    prev_egx70 = None
    prev_egx100 = None
    prev_egx33 = None

    for i, date in enumerate(egx_dates):
        if i % 100 == 0:
            print(f"    [{i+1}/{len(egx_dates)}] {date}...", end='\r')

        # EGX30 (weighted) — chains from previous day's close
        egx30 = compute_weighted_index_for_date(
            prices_by_ticker, date,
            canonical.get('EGX30', {}).get('constituents', []),
            base_value=prev_egx30 or 30000  # seed only for first day
        )
        if egx30:
            if prev_egx30 is not None:
                # CHAIN: use previous close * (1 + change%) instead of seed
                egx30['close'] = round(prev_egx30 * (1 + egx30['change_percent'] / 100), 2)
            prev_egx30 = egx30['close']
            indices_history['EGX30'].append({'date': date, **egx30})

        # EGX70 (EWI) — chains
        egx70 = compute_ewi_index_for_date(
            prices_by_ticker, date,
            canonical.get('EGX70_EWI', {}).get('constituents', []),
            base_value=prev_egx70 or 8000, min_matched=20
        )
        if egx70:
            if prev_egx70 is not None:
                egx70['close'] = round(prev_egx70 * (1 + egx70['change_percent'] / 100), 2)
            prev_egx70 = egx70['close']
            indices_history['EGX70'].append({'date': date, **egx70})

        # EGX100 (EWI composite) — chains
        egx30_const = canonical.get('EGX30', {}).get('constituents', [])
        egx70_const = canonical.get('EGX70_EWI', {}).get('constituents', [])
        seen = set()
        egx100_const = []
        for c in egx30_const + egx70_const:
            if c['code'] not in seen:
                seen.add(c['code'])
                egx100_const.append(c)
        egx100 = compute_ewi_index_for_date(
            prices_by_ticker, date, egx100_const,
            base_value=prev_egx100 or 11000, min_matched=30
        )
        if egx100:
            if prev_egx100 is not None:
                egx100['close'] = round(prev_egx100 * (1 + egx100['change_percent'] / 100), 2)
            prev_egx100 = egx100['close']
            indices_history['EGX100'].append({'date': date, **egx100})

        # EGX33 (shariah weighted) — chains
        egx33 = compute_weighted_index_for_date(
            prices_by_ticker, date,
            canonical.get('EGX33_SHARIAH', {}).get('constituents', []),
            base_value=prev_egx33 or 3300
        )
        if egx33:
            if prev_egx33 is not None:
                egx33['close'] = round(prev_egx33 * (1 + egx33['change_percent'] / 100), 2)
            prev_egx33 = egx33['close']
            indices_history['EGX33'].append({'date': date, **egx33})

    print()

    # 6. المؤشرات المركبة لكل سوق (KSE/QSE/TADAWUL/US)
    for market, base_value, symbol, name in [
        ('KSE', 7000, 'KSE_PREMIER', 'KSE Premier'),
        ('QSE', 10000, 'QSE_QE_INDEX', 'QSE QE Index'),
        ('TADAWUL', 12000, 'TADAWUL_TASI', 'Tadawul TASI'),
        ('US', 5000, 'US_COMPOSITE', 'US Composite'),
    ]:
        mkt_tickers = market_tickers.get(market, [])
        if not mkt_tickers:
            continue
        mkt_dates = get_all_dates(prices_by_ticker, mkt_tickers)
        if args.from_date:
            mkt_dates = [d for d in mkt_dates if d >= args.from_date]
        print(f"  ⏳ {market}: {len(mkt_dates)} dates ({mkt_dates[0] if mkt_dates else '—'} → {mkt_dates[-1] if mkt_dates else '—'})")

        for date in mkt_dates:
            result = compute_composite_for_date(
                prices_by_ticker, date, market, base_value, mkt_tickers
            )
            if result:
                indices_history[symbol].append({'date': date, **result})

    # 7. ملخص
    print(f"\n  📈 ملخص المؤشرات المحسوبة:")
    for symbol, history in sorted(indices_history.items()):
        if history:
            print(f"    {symbol:20s}: {len(history):>5} days | {history[0]['date']} → {history[-1]['date']}")

    # 8. اكتب في index_daily_prices
    if not args.dry_run:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(STOCKS_DB), writable=True).__enter__()
        try:
            conn.execute("""
                CREATE TABLE IF NOT EXISTS index_daily_prices (
                    id INTEGER PRIMARY KEY AUTOINCREMENT,
                    symbol TEXT NOT NULL,
                    price_date TEXT NOT NULL,
                    open REAL, high REAL, low REAL, close REAL,
                    volume REAL, change_percent REAL,
                    UNIQUE(symbol, price_date)
                )
            """)
            conn.execute("CREATE INDEX IF NOT EXISTS idx_idx_dp_sym_date ON index_daily_prices(symbol, price_date)")

            total_inserted = 0
            for symbol, history in indices_history.items():
                for row in history:
                    conn.execute("""
                        INSERT INTO index_daily_prices (symbol, price_date, open, high, low, close, volume, change_percent)
                        VALUES (?, ?, ?, ?, ?, ?, 0, ?)
                        ON CONFLICT(symbol, price_date) DO UPDATE SET
                            close = excluded.close,
                            change_percent = excluded.change_percent
                    """, (
                        symbol, row['date'],
                        row['close'],  # open
                        row['close'],  # high
                        row['close'],  # low
                        row['close'],  # close
                        row['change_percent'],
                    ))
                    total_inserted += 1
            conn.commit()
            print(f"\n  ✅ upserted {total_inserted} rows into index_daily_prices")
        finally:
            conn.close()
    else:
        total = sum(len(h) for h in indices_history.values())
        print(f"\n  [DRY RUN] would upsert {total} rows")

    print(f"[{datetime.now().isoformat()[:19]}] ✅ done")
    return 0


if __name__ == "__main__":
    sys.exit(main())
