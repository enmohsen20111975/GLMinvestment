#!/usr/bin/env python3
"""
🔬 Data Audit Script — التشخيص الشامل لمصادر الأسعار التاريخية
====================================================================
بروتوكول التشخيص قبل التنظيف (Data Surgery — Audit Phase).

السكريبت ده READ-ONLY. ميمسح ولا يعدّل أي حاجة في أي قاعدة بيانات.
هو بس بيفحص ويطبع تقرير يساعدنا نقرر قبل ما نعمل أي استبدال.

إيه اللي بيفحص؟
  1. يقرأ كل أسهم EGX النشطة من stocks.db (WHERE is_active = 1 AND market = 'EGX').
  2. لكل سهم، يفحص Yahoo Finance (yfinance) بـ period="max" و auto_adjust=False
     (عشان نجيب الأسعار الحقيقية مش المعدّلة).
  3. يطبع لكل سهم:
       - هل Yahoo عنده بيانات؟
       - كم سنة تاريخ متاح؟
       - أقدم تاريخ؟
       - آخر سعر close من Yahoo؟
  4. يقارن آخر سعر من Yahoo بآخر سعر من price_history.db (مصادر egksco/migration).
  5. لو الفرق أكتر من 3%، يطبع تحذير:
       ⚠️ تعارض في سعر COMI: Yahoo=130.00, DB=132.00 (فرق 1.5%)
  6. يطبع ملخص نهائي:
       "Yahoo عندو بيانات لـ X سهم من أصل Y. Z سهم مفيهمش بيانات على Yahoo."

ليه auto_adjust=False؟
  - Yahoo بيرجع Adjusted Close (بيخصم توزيعات الأرباح وتجزئة الأسهم).
  - فلما تقارن سعر قديم بسعر جديد، تلاقي القديم أعلى (غلط).
  - auto_adjust=False يجيب الأسعار الحقيقية (Raw) زي ما اتسجلت يوم الاتفاق.

Usage:
    python3 scripts/audit_price_data.py
    python3 scripts/audit_price_data.py --tickers COMI,ETEL,SWDY
    python3 scripts/audit_price_data.py --market EGX --threshold 5
    python3 scripts/audit_price_data.py --stocks-db /path/to/stocks.db --price-db /path/to/price_history.db
    python3 scripts/audit_price_data.py --json
"""

import sys
import os
import json
import argparse
import sqlite3
from pathlib import Path
from datetime import datetime

# ── Paths ──
PROJECT_ROOT = Path(__file__).parent.parent
DEFAULT_STOCKS_DB = PROJECT_ROOT / 'db' / 'stocks.db'
DEFAULT_PRICE_DB = PROJECT_ROOT / 'db' / 'price_history.db'

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

# ── Conflict threshold (default 3%) ──
DEFAULT_THRESHOLD_PCT = 3.0


# ═══════════════════════════════════════════════════════════════════════════
# Step 1: Read all active stocks from stocks.db
# ═══════════════════════════════════════════════════════════════════════════

def get_active_stocks(stocks_db_path, market='EGX', tickers=None):
    """يقرأ كل الأسهم النشطة من stocks.db.

    Returns:
        list of dicts: [{'ticker': 'COMI', 'name': '...', 'market': 'EGX',
                         'current_price': 130.0, 'last_updated': '...'}, ...]
    """
    stocks_db = Path(stocks_db_path)
    if not stocks_db.exists():
        print(f"❌ stocks.db غير موجود: {stocks_db}")
        return []

    conn = sqlite3.connect(str(stocks_db), timeout=30)
    conn.row_factory = sqlite3.Row
    conn.execute('PRAGMA busy_timeout = 30000')
    cur = conn.cursor()

    # التأكد من وجود الأعمدة المطلوبة
    try:
        cols = [r[1] for r in cur.execute('PRAGMA table_info(stocks)').fetchall()]
    except Exception:
        cols = []

    has_active = 'is_active' in cols
    has_market = 'market' in cols
    has_price = 'current_price' in cols
    has_last_updated = 'last_updated' in cols

    select_cols = ['ticker', 'name', 'market']
    if has_price:
        select_cols.append('current_price')
    if has_last_updated:
        select_cols.append('last_updated')

    select_sql = ', '.join(select_cols)

    if tickers:
        placeholders = ','.join('?' * len(tickers))
        query = f'SELECT {select_sql} FROM stocks WHERE ticker IN ({placeholders})'
        rows = cur.execute(query, [t.strip().upper() for t in tickers]).fetchall()
    elif has_active and has_market:
        query = f'SELECT {select_sql} FROM stocks WHERE is_active = 1 AND market = ?'
        rows = cur.execute(query, (market,)).fetchall()
    elif has_market:
        query = f'SELECT {select_sql} FROM stocks WHERE market = ?'
        rows = cur.execute(query, (market,)).fetchall()
    else:
        query = f'SELECT {select_sql} FROM stocks'
        rows = cur.execute(query).fetchall()

    conn.close()

    stocks = []
    for r in rows:
        if not r['ticker']:
            continue
        stocks.append({
            'ticker': r['ticker'],
            'name': r['name'] or '',
            'market': r['market'] or market,
            'current_price': r['current_price'] if has_price and r['current_price'] else None,
            'last_updated': r['last_updated'] if has_last_updated else None,
        })
    return stocks


# ═══════════════════════════════════════════════════════════════════════════
# Step 2: Get the latest close price for a ticker from price_history.db
# ═══════════════════════════════════════════════════════════════════════════

def get_db_latest_price(price_db_path, ticker, market='EGX'):
    """يجيب آخر سعر close من price_history.db لسهم معين (من كل المصادر).

    Returns:
        dict: {'price': float|None, 'date': str|None, 'source': str|None}
              لو مفيش بيانات → {'price': None, 'date': None, 'source': None}
    """
    price_db = Path(price_db_path)
    if not price_db.exists():
        return {'price': None, 'date': None, 'source': None, 'reason': 'db_missing'}

    base_ticker = ticker.upper().strip().split('.')[0]

    conn = sqlite3.connect(str(price_db), timeout=30)
    conn.execute('PRAGMA busy_timeout = 30000')
    cur = conn.cursor()

    # فحص الأعمدة
    try:
        cols = [c[1] for c in cur.execute('PRAGMA table_info(price_history)').fetchall()]
    except Exception:
        conn.close()
        return {'price': None, 'date': None, 'source': None, 'reason': 'table_missing'}

    has_source = 'source' in cols
    close_col = 'close_price' if 'close_price' in cols else ('close' if 'close' in cols else None)
    if close_col is None:
        conn.close()
        return {'price': None, 'date': None, 'source': None, 'reason': 'no_close_col'}

    result = {'price': None, 'date': None, 'source': None, 'reason': 'no_data'}

    try:
        if has_source:
            # هات آخر سعر من كل مصدر على حدة + الأحدث بشكل عام
            cur.execute('''
                SELECT date, close_price, source FROM price_history
                WHERE ticker = ? ORDER BY date DESC LIMIT 1
            ''', (base_ticker,))
            row = cur.fetchone()
            if row:
                result = {'price': float(row[1]) if row[1] else None,
                          'date': row[0], 'source': row[2], 'reason': 'ok'}

            # كمان هات آخر سعر من كل مصدر للتفاصيل
            cur.execute('''
                SELECT source, close_price, date FROM price_history
                WHERE ticker = ? AND source IN ('egksco','egx_investment_migration','yahoo_backfill','yahoo_clean')
                GROUP BY source
                HAVING date = MAX(date)
            ''', (base_ticker,))
            # SQLite ما بيدعمش GROUP BY + HAVING MAX كده بسهولة، فهات كل مصدر لوحده
            per_source = {}
            for src in ('egksco', 'egx_investment_migration', 'yahoo_backfill', 'yahoo_clean'):
                cur.execute('''
                    SELECT close_price, date FROM price_history
                    WHERE ticker = ? AND source = ?
                    ORDER BY date DESC LIMIT 1
                ''', (base_ticker, src))
                r2 = cur.fetchone()
                if r2 and r2[0]:
                    per_source[src] = {'price': float(r2[0]), 'date': r2[1]}
            result['per_source'] = per_source
        else:
            cur.execute('''
                SELECT date, close_price FROM price_history
                WHERE ticker = ? ORDER BY date DESC LIMIT 1
            ''', (base_ticker,))
            row = cur.fetchone()
            if row:
                result = {'price': float(row[1]) if row[1] else None,
                          'date': row[0], 'source': None, 'reason': 'ok'}
    except sqlite3.OperationalError as e:
        result = {'price': None, 'date': None, 'source': None, 'reason': f'error: {e}'}
    finally:
        conn.close()

    return result


# ═══════════════════════════════════════════════════════════════════════════
# Step 3: Fetch Yahoo Finance metadata (READ-ONLY, auto_adjust=False)
# ═══════════════════════════════════════════════════════════════════════════

def fetch_yahoo_audit(ticker, market):
    """يفحص Yahoo Finance لسهم واحد بـ period="max" و auto_adjust=False.

    Returns:
        dict: {
            'available': bool,
            'yf_ticker': 'COMI.CA',
            'rows': int,
            'oldest_date': 'YYYY-MM-DD' | None,
            'latest_date': 'YYYY-MM-DD' | None,
            'latest_close': float | None,
            'years_span': float | None,
            'error': str | None,
        }
    """
    result = {
        'available': False,
        'yf_ticker': None,
        'rows': 0,
        'oldest_date': None,
        'latest_date': None,
        'latest_close': None,
        'years_span': None,
        'error': None,
    }

    try:
        import yfinance as yf
    except ImportError:
        result['error'] = 'yfinance not installed'
        return result

    suffix = MARKET_SUFFIXES.get(market, '')
    yf_ticker = f"{ticker}{suffix}"
    result['yf_ticker'] = yf_ticker

    try:
        stock = yf.Ticker(yf_ticker)
        # auto_adjust=False = الأسعار الحقيقية (Raw) مش المعدّلة
        df = stock.history(period='max', auto_adjust=False)
    except Exception as e:
        result['error'] = f'yfinance error: {str(e)[:100]}'
        return result

    if df is None or df.empty:
        result['error'] = 'no data returned'
        return result

    try:
        result['available'] = True
        result['rows'] = int(len(df))
        result['oldest_date'] = df.index[0].strftime('%Y-%m-%d')
        result['latest_date'] = df.index[-1].strftime('%Y-%m-%d')

        close_col = 'Close'
        # لو auto_adjust=False، yfinance ممكن يرجع MultiIndex في نسخ أحدث
        if isinstance(df.columns, type(df.index)):  # MultiIndex
            if close_col in df.columns.get_level_values(0):
                close_series = df[close_col].iloc[:, 0] if hasattr(df[close_col], 'iloc') and df[close_col].ndim > 1 else df[close_col]
            else:
                close_series = df.iloc[:, 0]
        else:
            close_series = df[close_col] if close_col in df.columns else df.iloc[:, 0]

        last_val = close_series.iloc[-1]
        if last_val == last_val:  # NaN check
            result['latest_close'] = float(last_val)

        # حساب عدد السنوات
        if result['oldest_date'] and result['latest_date']:
            try:
                d1 = datetime.strptime(result['oldest_date'], '%Y-%m-%d')
                d2 = datetime.strptime(result['latest_date'], '%Y-%m-%d')
                result['years_span'] = round((d2 - d1).days / 365.25, 2)
            except Exception:
                pass
    except Exception as e:
        result['error'] = f'parse error: {str(e)[:100]}'

    return result


# ═══════════════════════════════════════════════════════════════════════════
# Step 4: Compare Yahoo vs DB and detect conflicts
# ═══════════════════════════════════════════════════════════════════════════

def compare_prices(yahoo_price, db_price, threshold_pct=DEFAULT_THRESHOLD_PCT):
    """يقارن سعر Yahoo بسعر الـ DB ويحدد لو فيه تعارض.

    Returns:
        dict: {
            'diff_pct': float | None,
            'conflict': bool,
            'verdict': 'match' | 'conflict' | 'incomparable',
        }
    """
    if yahoo_price is None or db_price is None:
        return {'diff_pct': None, 'conflict': False, 'verdict': 'incomparable'}

    if yahoo_price <= 0 or db_price <= 0:
        return {'diff_pct': None, 'conflict': False, 'verdict': 'incomparable'}

    diff_pct = abs(yahoo_price - db_price) / db_price * 100.0
    conflict = diff_pct > threshold_pct
    verdict = 'conflict' if conflict else 'match'
    return {'diff_pct': round(diff_pct, 2), 'conflict': conflict, 'verdict': verdict}


# ═══════════════════════════════════════════════════════════════════════════
# Main: run audit across all stocks
# ═══════════════════════════════════════════════════════════════════════════

def run_audit(stocks_db, price_db, market='EGX', tickers=None,
              threshold_pct=DEFAULT_THRESHOLD_PCT, verbose=True, sleep_s=0.0):
    """يشغّل الـ audit الكامل ويطبع تقرير.

    Returns:
        dict: تقرير كامل (للـ JSON output)
    """
    import time

    stocks = get_active_stocks(stocks_db, market=market, tickers=tickers)

    if not stocks:
        print(f"\n⚠️  مفيش أسهم نشطة في stocks.db للسوق '{market}'.")
        print(f"   تأكد إن stocks.db فيه أسهم و is_active = 1 AND market = '{market}'.")
        print(f"   path: {stocks_db}")
        return {'total': 0, 'available': 0, 'missing': 0, 'conflicts': 0,
                'details': [], 'market': market}

    print(f"\n🔬 DATA AUDIT — التشخيص الشامل لمصادر Yahoo Finance")
    print(f"{'='*70}")
    print(f"  Market              : {market}")
    print(f"  Total stocks (DB)   : {len(stocks)}")
    print(f"  stocks.db path      : {stocks_db}")
    print(f"  price_history.db    : {price_db}")
    print(f"  Conflict threshold  : {threshold_pct}%")
    print(f"  Yahoo mode          : period='max', auto_adjust=False (RAW prices)")
    print(f"{'='*70}")

    available_count = 0
    missing_count = 0
    conflict_count = 0
    details = []

    for idx, stock in enumerate(stocks, 1):
        ticker = stock['ticker']
        stk_market = stock['market'] or market
        name = stock['name'][:25]

        # 1. Yahoo audit
        yf_info = fetch_yahoo_audit(ticker, stk_market)

        # 2. DB latest price
        db_info = get_db_latest_price(price_db, ticker, stk_market)

        # 3. Compare
        db_price = db_info.get('price')
        yf_price = yf_info.get('latest_close')
        cmp = compare_prices(yf_price, db_price, threshold_pct)

        if yf_info['available']:
            available_count += 1
        else:
            missing_count += 1

        if cmp['conflict']:
            conflict_count += 1

        detail = {
            'ticker': ticker,
            'name': stock['name'],
            'market': stk_market,
            'yahoo': yf_info,
            'db': db_info,
            'comparison': cmp,
        }
        details.append(detail)

        # 4. Print per-stock line
        if verbose:
            yf_mark = '✅' if yf_info['available'] else '❌'
            if yf_info['available']:
                years = yf_info.get('years_span', 0) or 0
                close_str = f"{yf_price:.2f}" if yf_price else 'N/A'
                line = (f"  [{idx:>4}/{len(stocks)}] {yf_mark} {ticker:<8} {name:<25} "
                        f"| Y={years:>5.1f}y rows={yf_info['rows']:>5} "
                        f"close={close_str:>10}")
            else:
                err = (yf_info.get('error') or '')[:40]
                line = (f"  [{idx:>4}/{len(stocks)}] {yf_mark} {ticker:<8} {name:<25} "
                        f"| NO YAHOO DATA ({err})")

            # DB comparison
            if db_price:
                line += f"  | DB={db_price:.2f}({db_info.get('source','?')[:8]})"
                if cmp['conflict']:
                    line += f"  ⚠️ فرق={cmp['diff_pct']:.1f}%"
            else:
                line += f"  | DB=NONE"

            print(line)

        if sleep_s > 0:
            time.sleep(sleep_s)

    # ── Final Summary ──
    print(f"\n{'='*70}")
    print(f"  📊 AUDIT REPORT — Yahoo Finance Coverage for EGX")
    print(f"{'='*70}")
    print(f"  ✅ Yahoo عنده بيانات لـ    : {available_count:>4} سهم")
    print(f"  ❌ Yahoo مفيهوش بيانات لـ   : {missing_count:>4} سهم")
    print(f"  ⚠️  تعارض في السعر (> {threshold_pct}%) : {conflict_count:>4} سهم")
    print(f"  ────────────────────────────────────")
    print(f"  📁 الإجمالي              : {len(stocks):>4} سهم")
    print(f"{'='*70}")

    if missing_count > 0:
        print(f"\n  ── الأسهم اللي Yahoo مش متوفر ليها ──")
        for d in details:
            if not d['yahoo']['available']:
                err = (d['yahoo'].get('error') or '')[:50]
                print(f"    {d['ticker']:<8} ({d['market']}) → {err}")

    if conflict_count > 0:
        print(f"\n  ── تعارضات الأسعار (فرق > {threshold_pct}%) ──")
        for d in details:
            if d['comparison']['conflict']:
                yf_p = d['yahoo']['latest_close']
                db_p = d['db']['price']
                src = d['db'].get('source', '?')
                print(f"    ⚠️ {d['ticker']:<8}: Yahoo={yf_p:.2f}, "
                      f"DB={db_p:.2f}({src}), فرق={d['comparison']['diff_pct']:.1f}%")

    # نصيحة لما بعدها
    print(f"\n  💡 الخطوة التالية:")
    print(f"     - شغّل backfill_yahoo_history.py لسحب البيانات النظيفة (yahoo_clean).")
    print(f"     - السكريبت هيستخدم period='max' + auto_adjust=False.")
    print(f"     - لو فيه تعارضات، راجعها يدوياً قبل ما تعتمد yahoo_clean.")
    print(f"{'='*70}\n")

    return {
        'total': len(stocks),
        'available': available_count,
        'missing': missing_count,
        'conflicts': conflict_count,
        'threshold_pct': threshold_pct,
        'market': market,
        'generated_at': datetime.now().isoformat(),
        'details': details,
    }


# ═══════════════════════════════════════════════════════════════════════════
# CLI Entry Point
# ═══════════════════════════════════════════════════════════════════════════

def main():
    parser = argparse.ArgumentParser(
        description='🔬 Data Audit — التشخيص الشامل لمصادر Yahoo Finance (READ-ONLY)',
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog="""
أمثلة:
  # audit كامل لأسهم EGX
  python3 scripts/audit_price_data.py

  # أسهم محددة بس (سريع للاختبار)
  python3 scripts/audit_price_data.py --tickers COMI,ETEL,SWDY

  # تغيير حد التعارض لـ 5%
  python3 scripts/audit_price_data.py --threshold 5

  # تحديد مسار DB مخصص (للتشخيص من backup)
  python3 scripts/audit_price_data.py --stocks-db db/stocks.db.bak.1227285

  # إخراج JSON
  python3 scripts/audit_price_data.py --json
        """
    )
    parser.add_argument('--market', type=str, default='EGX',
                        help='السوق (default: EGX)')
    parser.add_argument('--tickers', type=str, default=None,
                        help='قائمة أسهم محددة. e.g., COMI,ETEL,SWDY')
    parser.add_argument('--stocks-db', type=str, default=str(DEFAULT_STOCKS_DB),
                        help=f'مسار stocks.db (default: {DEFAULT_STOCKS_DB})')
    parser.add_argument('--price-db', type=str, default=str(DEFAULT_PRICE_DB),
                        help=f'مسار price_history.db (default: {DEFAULT_PRICE_DB})')
    parser.add_argument('--threshold', type=float, default=DEFAULT_THRESHOLD_PCT,
                        help=f'حد التعارض بالـ%% (default: {DEFAULT_THRESHOLD_PCT}%%)')
    parser.add_argument('--sleep', type=float, default=0.0,
                        help='تأخير بين كل سهم (default: 0.0s)')
    parser.add_argument('--quiet', action='store_true',
                        help='بدون طباعة تفصيلية (الملخص النهائي بس)')
    parser.add_argument('--json', action='store_true',
                        help='إخراج JSON بدلاً من نص + حفظ التقرير')

    args = parser.parse_args()

    tickers = None
    if args.tickers:
        tickers = [t.strip().upper() for t in args.tickers.split(',') if t.strip()]

    result = run_audit(
        stocks_db=args.stocks_db,
        price_db=args.price_db,
        market=args.market,
        tickers=tickers,
        threshold_pct=args.threshold,
        verbose=not args.quiet,
        sleep_s=args.sleep,
    )

    # حفظ التقرير في ملف JSON دائماً
    report_path = PROJECT_ROOT / 'db' / f'audit_price_report_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    report_path.parent.mkdir(parents=True, exist_ok=True)
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(result, f, indent=2, ensure_ascii=False, default=str)
    print(f"💾 Report saved to: {report_path}")

    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False, default=str))


if __name__ == '__main__':
    main()
