#!/usr/bin/env python3
"""
📚 Yahoo Finance Backfill — CLEAN (النسخة النظيفة)
====================================================
بروتوكول التنظيف الآمن (Data Surgery — Clean Backfill Phase).

الفرق عن النسخة القديمة (yahoo_backfill):
  1. المصدر: `yahoo_clean` (مش `yahoo_backfill` القديم المسموم).
  2. period='max' بدل --days 365 (نسحب كل التاريخ المتاح، ممكن يوصل 25 سنة).
  3. auto_adjust=False (نجيب الأسعار الحقيقية Raw مش المعدّلة Adjusted).
     - Adjusted Close بياخد توزيعات الأرباح وتجزئة الأسهم في الاعتبار،
       فبيخلي الأسعار القديمة أقل من الحقيقي → تحليل غلط.
     - Raw Close = السعر زي ما اتسجل يوم الاتفاق.
  4. لو Yahoo مش متوفر لسهم، بنسجل رسالة واضحة ونتخطاه (من غير فشل).

الـ UNIQUE(ticker, date, source) في price_history.db بيضمن:
  - لو شغّلنا السكريبت تاني، البيانات الجديدة (yahoo_clean) تنضاف جنب القديمة.
  - مفيش أي بيانات قديمة (egksco / migration / yahoo_backfill) تتمسح.
  - load_merged_history بعدها هيختار yahoo_clean بالأولوية.

Usage:
    # backfill كامل لكل أسهم EGX (period=max, auto_adjust=False)
    python3 scripts/backfill_yahoo_history.py

    # أسهم محددة بس
    python3 scripts/backfill_yahoo_history.py --tickers COMI,ETEL,SWDY

    # لو محتاج نحدد فترة (override على max)
    python3 scripts/backfill_yahoo_history.py --days 1825

    # سوق مختلف
    python3 scripts/backfill_yahoo_history.py --market TADAWUL
"""

import sys
import os
import time
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime, timedelta

# ── Paths ──
PROJECT_ROOT = Path(__file__).parent.parent
STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
PRICE_HISTORY_DB = PROJECT_ROOT / 'db' / 'price_history.db'

# ── Yahoo Finance ticker suffixes per market ──
MARKET_SUFFIXES = {
    'EGX': '.CA',        # Cairo exchange
    'TADAWUL': '.SR',    # Saudi exchange
    'KSE': '.KW',        # Kuwait
    'QSE': '.QA',        # Qatar
    'US': '',            # US stocks (no suffix)
    'NASDAQ': '',
    'NYSE': '',
}

# ✅ المصدر النظيف (مش yahoo_backfill القديم المسموم)
SOURCE = 'yahoo_clean'


# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Read all active stocks from stocks.db
# ═══════════════════════════════════════════════════════════════════════════

def get_active_stocks(market='EGX', tickers=None):
    """يقرأ كل الأسهم النشطة من stocks.db.

    Returns:
        list of dicts: [{'ticker': 'COMI', 'name': '...', 'market': 'EGX'}, ...]
    """
    if not STOCKS_DB.exists():
        print(f"❌ stocks.db غير موجود: {STOCKS_DB}")
        return []

    conn = sqlite3.connect(str(STOCKS_DB), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout = 30000')
    cur = conn.cursor()

    try:
        cols = [r[1] for r in cur.execute('PRAGMA table_info(stocks)').fetchall()]
    except Exception:
        cols = []

    has_active = 'is_active' in cols
    has_market = 'market' in cols

    if tickers:
        placeholders = ','.join('?' * len(tickers))
        query = f'SELECT ticker, name, market FROM stocks WHERE ticker IN ({placeholders})'
        rows = cur.execute(query, [t.strip().upper() for t in tickers]).fetchall()
    elif has_active and has_market:
        query = 'SELECT ticker, name, market FROM stocks WHERE is_active = 1 AND market = ?'
        rows = cur.execute(query, (market,)).fetchall()
    elif has_market:
        query = 'SELECT ticker, name, market FROM stocks WHERE market = ?'
        rows = cur.execute(query, (market,)).fetchall()
    else:
        rows = cur.execute('SELECT ticker, name, market FROM stocks').fetchall()

    conn.close()

    stocks = [{'ticker': r['ticker'], 'name': r['name'] or '', 'market': r['market'] or market}
              for r in rows if r['ticker']]
    return stocks


# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Fetch history from Yahoo Finance (CLEAN: max + auto_adjust=False)
# ═══════════════════════════════════════════════════════════════════════════

def fetch_yahoo_history(ticker, market, days=None):
    """يسحب OHLCV يومي لسهم واحد من Yahoo Finance.

    ✅ CLEAN MODE: period='max' + auto_adjust=False (الأسعار الحقيقية Raw).

    Args:
        ticker:  رمز السهم (e.g., 'COMI')
        market:  السوق (e.g., 'EGX') — لتحديد لاحقة Yahoo
        days:    لو محدد، نسحب آخر N يوم بس. لو None، نسحب period='max'.

    Returns:
        dict: {
            'candles': [...],
            'oldest_date': 'YYYY-MM-DD',
            'latest_date': 'YYYY-MM-DD',
            'years_span': float,
            'yf_ticker': 'COMI.CA',
        }
    Raises:
        RuntimeError: لو yfinance رجع خطأ أو مفيش بيانات.
    """
    try:
        import yfinance as yf
    except ImportError:
        print("❌ yfinance غير مثبت. ثبته بـ: pip install yfinance")
        sys.exit(1)

    suffix = MARKET_SUFFIXES.get(market, '')
    yf_ticker = f"{ticker}{suffix}"

    try:
        stock = yf.Ticker(yf_ticker)
        if days:
            # لو محدد days، نسحب آخر N يوم
            end_date = datetime.now()
            start_date = end_date - timedelta(days=days)
            df = stock.history(start=start_date.strftime('%Y-%m-%d'),
                               end=end_date.strftime('%Y-%m-%d'),
                               auto_adjust=False)
        else:
            # ✅ CLEAN: period='max' + auto_adjust=False
            df = stock.history(period='max', auto_adjust=False)
    except Exception as e:
        raise RuntimeError(f"yfinance error: {str(e)[:80]}")

    if df is None or df.empty:
        raise RuntimeError(f"no data returned for {yf_ticker}")

    candles = []
    oldest_date = None
    latest_date = None

    for date, row in df.iterrows():
        try:
            date_str = date.strftime('%Y-%m-%d')
            if oldest_date is None:
                oldest_date = date_str
            latest_date = date_str

            # NaN check (x == x is False for NaN)
            open_p = float(row['Open']) if row['Open'] == row['Open'] else 0.0
            high_p = float(row['High']) if row['High'] == row['High'] else 0.0
            low_p = float(row['Low']) if row['Low'] == row['Low'] else 0.0
            close_p = float(row['Close']) if row['Close'] == row['Close'] else 0.0
            vol = int(row['Volume']) if row['Volume'] == row['Volume'] else 0

            if close_p <= 0:
                continue

            candles.append({
                'date': date_str,
                'open': open_p,
                'high': high_p,
                'low': low_p,
                'close': close_p,
                'volume': vol,
            })
        except (ValueError, TypeError, KeyError):
            continue

    if not candles:
        raise RuntimeError(f"no valid candles for {yf_ticker}")

    # حساب عدد السنوات
    years_span = 0.0
    if oldest_date and latest_date:
        try:
            d1 = datetime.strptime(oldest_date, '%Y-%m-%d')
            d2 = datetime.strptime(latest_date, '%Y-%m-%d')
            years_span = round((d2 - d1).days / 365.25, 2)
        except Exception:
            pass

    return {
        'candles': candles,
        'oldest_date': oldest_date,
        'latest_date': latest_date,
        'years_span': years_span,
        'yf_ticker': yf_ticker,
    }


# ═══════════════════════════════════════════════════════════════════════════
# Step 3: UPSERT into price_history.db
# ═══════════════════════════════════════════════════════════════════════════

def ensure_price_history_table(conn):
    """يتأكد إن جدول price_history موجود بالـ schema الصحيح."""
    conn.execute('''
        CREATE TABLE IF NOT EXISTS price_history (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ticker TEXT NOT NULL,
            date TEXT NOT NULL,
            open_price REAL,
            high_price REAL,
            low_price REAL,
            close_price REAL,
            volume INTEGER DEFAULT 0,
            source TEXT DEFAULT 'yahoo_clean',
            created_at TEXT DEFAULT (datetime('now')),
            UNIQUE(ticker, date, source)
        )
    ''')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_ph_ticker_date ON price_history(ticker, date)')
    conn.execute('CREATE INDEX IF NOT EXISTS idx_ph_ticker_source ON price_history(ticker, source)')
    conn.commit()


def upsert_price_history(conn, ticker, candles):
    """يعمل UPSERT (INSERT OR REPLACE) لشموع سهم واحد.

    الـ UNIQUE(ticker, date, source) يضمن:
      - لو نفس التاريخ موجود بنفس المصدر → يستبدله.
      - لو نفس التاريخ موجود بمصدر مختلف (egksco/migration) → يحتفظ بالاتنين.
        (load_merged_history بعدها هيختار yahoo_clean بالأولوية)

    Returns:
        int: عدد الشموع اللي اتحفظت
    """
    saved = 0
    for c in candles:
        try:
            conn.execute('''
                INSERT OR REPLACE INTO price_history
                    (ticker, date, open_price, high_price, low_price, close_price, volume, source)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            ''', (
                ticker.upper().strip(),
                c['date'],
                c['open'], c['high'], c['low'], c['close'],
                c['volume'],
                SOURCE,
            ))
            saved += 1
        except sqlite3.Error:
            continue
    conn.commit()
    return saved


# ═══════════════════════════════════════════════════════════════════════════
# Main: backfill all stocks
# ═══════════════════════════════════════════════════════════════════════════

def run_backfill(market='EGX', days=None, tickers=None, sleep_s=0.3, verbose=True):
    """يشغّل الـ backfill النظيف لكل الأسهم النشطة.

    Args:
        market:  السوق (default 'EGX')
        days:    None = period='max' (default). لو رقم، نسحب آخر N يوم.
        tickers: قائمة أسهم محددة (override)
        sleep_s: تأخير بين كل سهم والآخر (لتجنب rate limit)
        verbose: طباعة تقدم مفصّل

    Returns:
        dict: تقرير كامل
    """
    stocks = get_active_stocks(market=market, tickers=tickers)

    if tickers and not stocks:
        stocks = [{'ticker': t, 'name': f'{t} (CLI)', 'market': market}
                  for t in tickers]
        print(f"\nℹ️  {len(tickers)} ticker(s) specified via --tickers but not found in stocks.db — proceeding directly.")

    if not stocks:
        print(f"\n⚠️  مفيش أسهم نشطة في stocks.db للسوق '{market}'.")
        print(f"   تأكد إن stocks.db فيه أسهم و is_active = 1 AND market = '{market}'.")
        return {'total': 0, 'success': 0, 'failed': 0, 'skipped': 0,
                'total_candles': 0, 'details': []}

    mode_label = f"period='max' (auto_adjust=False)" if days is None else f"last {days} days (auto_adjust=False)"

    print(f"\n📚 YAHOO CLEAN BACKFILL — DATA SURGERY")
    print(f"{'='*60}")
    print(f"  Market           : {market}")
    print(f"  Total stocks     : {len(stocks)}")
    print(f"  Mode             : {mode_label}")
    print(f"  Source label     : {SOURCE}  ← (مش yahoo_backfill القديم)")
    print(f"  Target DB        : {PRICE_HISTORY_DB}")
    print(f"  Sleep between    : {sleep_s}s")
    print(f"{'='*60}")

    PRICE_HISTORY_DB.parent.mkdir(parents=True, exist_ok=True)
    conn = sqlite3.connect(str(PRICE_HISTORY_DB), timeout=30)
    conn.execute('PRAGMA busy_timeout = 30000')
    ensure_price_history_table(conn)

    success = 0
    failed = 0
    skipped = 0
    total_candles = 0
    details = []

    for idx, stock in enumerate(stocks, 1):
        ticker = stock['ticker']
        stk_market = stock['market'] or market
        name = stock['name'][:25]

        try:
            result = fetch_yahoo_history(ticker, stk_market, days=days)
            candles = result['candles']
        except Exception as e:
            failed += 1
            err_msg = str(e)[:60]
            # ✅ رسالة واضحة لو Yahoo مش متوفر
            if 'no data' in err_msg.lower() or 'no valid' in err_msg.lower():
                print(f"  [{idx:>4}/{len(stocks)}] ⚠️  {ticker:<8} {name:<25} → ياهو مش متوفر لسهم {ticker}، سيتم استخدام EGKSCO بس للسعر الحالي")
            else:
                print(f"  [{idx:>4}/{len(stocks)}] ❌ {ticker:<8} {name:<25} → FAILED: {err_msg}")
            details.append({'ticker': ticker, 'status': 'FAILED', 'reason': err_msg, 'candles': 0})
            time.sleep(sleep_s)
            continue

        if not candles:
            skipped += 1
            print(f"  [{idx:>4}/{len(stocks)}] ⏭️  {ticker:<8} {name:<25} → ياهو مش متوفر لسهم {ticker}، سيتم استخدام EGKSCO بس للسعر الحالي")
            details.append({'ticker': ticker, 'status': 'SKIPPED', 'reason': 'no candles from yahoo', 'candles': 0})
            time.sleep(sleep_s)
            continue

        saved = upsert_price_history(conn, ticker, candles)
        success += 1
        total_candles += saved

        # ✅ طباعة مدى السنوات: "تم سحب X سنة لسهم COMI من 2020-01-01 لـ 2026-07-30"
        years = result['years_span']
        oldest = result['oldest_date']
        latest = result['latest_date']
        print(f"  [{idx:>4}/{len(stocks)}] ✅ {ticker:<8} {name:<25} → {saved:>5} candles | تم سحب {years} سنة من {oldest} لـ {latest}")

        details.append({
            'ticker': ticker,
            'status': 'OK',
            'candles': saved,
            'years_span': years,
            'oldest_date': oldest,
            'latest_date': latest,
        })

        time.sleep(sleep_s)

    conn.close()

    # ── Final Report ──
    print(f"\n{'='*60}")
    print(f"  📊 CLEAN BACKFILL REPORT — Yahoo → price_history.db")
    print(f"{'='*60}")
    print(f"  ✅ نجح  (success) : {success:>4} سهم")
    print(f"  ❌ فشل  (failed)  : {failed:>4} سهم")
    print(f"  ⏭️  تخطى (skipped) : {skipped:>4} سهم (Yahoo مش متوفر)")
    print(f"  ─────────────────────────────")
    print(f"  📁 الإجمالي        : {len(stocks):>4} سهم")
    print(f"  📅 إجمالي الشموع   : {total_candles:>6} شمعة يومية")
    print(f"  🏷️  المصدر          : {SOURCE}")
    print(f"  💾 قاعدة البيانات   : {PRICE_HISTORY_DB}")
    print(f"{'='*60}")

    print(f"\n  تم سحب بيانات {success} سهم بمصدر {SOURCE}، فشل في {failed} سهم.")

    if failed > 0 and verbose:
        print(f"\n  ── تفاصيل الفشل (ياهو مش متوفر ليهم — هيفضلوا يعتمدوا على EGKSCO) ──")
        for d in details:
            if d['status'] == 'FAILED':
                print(f"    {d['ticker']:<8} → {d['reason']}")

    return {
        'total': len(stocks),
        'success': success,
        'failed': failed,
        'skipped': skipped,
        'total_candles': total_candles,
        'details': details,
        'generated_at': datetime.now().isoformat(),
        'market': market,
        'mode': mode_label,
        'source': SOURCE,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='📚 Yahoo Clean Backfill — period=max, auto_adjust=False, source=yahoo_clean',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  # backfill كامل (period=max, auto_adjust=False, source=yahoo_clean)
  python3 scripts/backfill_yahoo_history.py

  # أسهم محددة
  python3 scripts/backfill_yahoo_history.py --tickers COMI,ETEL,SWDY

  # لو محتاج تحديد فترة (override على max)
  python3 scripts/backfill_yahoo_history.py --days 1825

  # سوق مختلف
  python3 scripts/backfill_yahoo_history.py --market TADAWUL
        """
    )
    parser.add_argument('--market', type=str, default='EGX',
                        help='السوق (default: EGX)')
    parser.add_argument('--days', type=int, default=None,
                        help='عدد أيام التاريخ. لو محددش، بنستخدم period=max (default: None = max)')
    parser.add_argument('--tickers', type=str, default=None,
                        help='قائمة أسهم محددة. e.g., COMI,ETEL,SWDY')
    parser.add_argument('--sleep', type=float, default=0.3,
                        help='تأخير بين كل سهم (default: 0.3s)')
    parser.add_argument('--quiet', action='store_true',
                        help='بدون طباعة تفصيلية')
    parser.add_argument('--json', action='store_true',
                        help='إخراج JSON')

    args = parser.parse_args()

    tickers = None
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]

    result = run_backfill(
        market=args.market,
        days=args.days,
        tickers=tickers,
        sleep_s=args.sleep,
        verbose=not args.quiet,
    )

    import json
    report_path = PROJECT_ROOT / 'db' / f'yahoo_clean_backfill_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False, default=str)
    if not args.json:
        print(f"\n💾 Report saved to: {report_path}")

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
