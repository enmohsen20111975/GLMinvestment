#!/usr/bin/env python3
"""
GLMinvestment — Deep DB Audit (read-only)
==========================================
سكربت فحص أعمق بـ يدور على كل جدول في كل DB ويحدد:
- عدد الصفوف
- الأعمدة
- هل فيه أعمدة تشير لأسعار تاريخية (ticker + date + close/open/high/low)
- هل فيه بيانات للأسهم الانفجارية (BIOC/NIPH/AMES/...)

السكربت READ-ONLY: ما بـ يـ modifyش أي حاجة.

USAGE:
  python3 scripts/audit_dbs_deep.py                — فحص كل الـ DBs
  python3 scripts/audit_dbs_deep.py data_engine   — فحص data_engine.db بس
  python3 scripts/audit_dbs_deep.py stocks        — فحص stocks.db بس
  python3 scripts/audit_dbs_deep.py price_history — فحص price_history.db بس
  python3 scripts/audit_dbs_deep.py all           — فحص كل الـ DBs (default)
"""
import os
import sys
import sqlite3
from pathlib import Path
from collections import defaultdict

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
EXLODER_TICKERS = ['BIOC', 'NIPH', 'AMES', 'GPIM', 'AFMC', 'GTWL', 'CRST']

# كل الـ DBs الممكن وجودها
ALL_DBS = [
    'data_engine.db',
    'price_history.db',
    'stocks.db',
    'market.db',
    'predictions.db',
    'auth.db',
    'content.db',
    'crypto.db',
    'macro.db',
    'intraday.db',
    'news.db',
    'telegram_data.db',
]

# أعمدة تشير لـ ticker/symbol
TICKER_COLS = {'ticker', 'symbol', 'stock', 'stock_symbol', 'code'}
# أعمدة تشير لـ date
DATE_COLS = {'date', 'price_date', 'trade_date', 'timestamp', 'datetime', 'created_at'}
# أعمدة تشير لـ close price
PRICE_COLS = {'close', 'close_price', 'last_price', 'price', 'last'}
# أعمدة تشير لـ OHLC
OHLC_COLS = {'open', 'open_price', 'high', 'high_price', 'low', 'low_price', 'close', 'close_price'}


def section(title):
    print()
    print('=' * 78)
    print(f'  {title}')
    print('=' * 78)


def _connect_ro(db_path):
    try:
        if not os.path.exists(db_path):
            return None
        return sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=10.0)
    except Exception:
        return None


def _get_tables(conn):
    try:
        return [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()]
    except Exception:
        return []


def _get_columns(conn, table):
    try:
        return [r[1] for r in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]
    except Exception:
        return []


def _get_count(conn, table):
    try:
        return conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
    except Exception:
        return -1


def _classify_table(cols):
    """صنّف الجدول: هل هو candidate لـ price history؟"""
    cols_lower = {c.lower() for c in cols}
    has_ticker = bool(cols_lower & TICKER_COLS)
    has_date = bool(cols_lower & DATE_COLS)
    has_price = bool(cols_lower & (PRICE_COLS | OHLC_COLS))
    
    if has_ticker and has_date and has_price:
        # in_price_history candidate
        ticker_col = next((c for c in cols if c.lower() in TICKER_COLS), None)
        date_col = next((c for c in cols if c.lower() in DATE_COLS), None)
        price_col = next((c for c in cols if c.lower() in PRICE_COLS), None)
        return {
            'type': 'PRICE_HISTORY_CANDIDATE',
            'ticker_col': ticker_col,
            'date_col': date_col,
            'price_col': price_col,
        }
    return {'type': 'OTHER'}


def _check_exploders(conn, table, ticker_col, date_col):
    """فحص الأسهم الانفجارية في الجدول."""
    findings = {}
    for t in EXLODER_TICKERS:
        try:
            r = conn.execute(
                f'SELECT COUNT(*), MIN("{date_col}"), MAX("{date_col}") '
                f'FROM "{table}" WHERE "{ticker_col}" = ?',
                (t,)
            ).fetchone()
            findings[t] = {'rows': r[0], 'first': r[1], 'last': r[2]}
        except Exception:
            findings[t] = {'rows': -1, 'first': None, 'last': None}
    return findings


def audit_db(db_name, verbose=True):
    """فحص DB واحد بالكامل."""
    db_path = DB_DIR / db_name
    section(f'DB: {db_name}')
    
    if not os.path.exists(db_path):
        print(f'  ❌ NOT FOUND: {db_path}')
        return None
    
    size_mb = os.path.getsize(db_path) / (1024 * 1024)
    print(f'  Path: {db_path}')
    print(f'  Size: {size_mb:.1f} MB')
    
    conn = _connect_ro(str(db_path))
    if conn is None:
        print('  ❌ Cannot open (read-only)')
        return None
    
    tables = _get_tables(conn)
    print(f'  Tables: {len(tables)}')
    
    if not tables:
        print('  (no tables)')
        conn.close()
        return None
    
    summary = {'db': db_name, 'size_mb': size_mb, 'tables': []}
    candidates = []
    
    for table in tables:
        cols = _get_columns(conn, table)
        count = _get_count(conn, table)
        cls = _classify_table(cols)
        
        info = {
            'table': table,
            'rows': count,
            'cols': cols,
            'type': cls['type'],
        }
        summary['tables'].append(info)
        
        if verbose:
            status = '✓' if count > 0 else '∅'
            marker = '⭐' if cls['type'] == 'PRICE_HISTORY_CANDIDATE' else '  '
            print(f'  {marker} {status} {table:45s} {count:>10,} rows')
            if count > 0 and cls['type'] == 'PRICE_HISTORY_CANDIDATE':
                print(f'         cols: {cols}')
        
        if count > 0 and cls['type'] == 'PRICE_HISTORY_CANDIDATE':
            # فحص الأسهم الانفجارية
            exploders = _check_exploders(conn, table, cls['ticker_col'], cls['date_col'])
            info['ticker_col'] = cls['ticker_col']
            info['date_col'] = cls['date_col']
            info['price_col'] = cls['price_col']
            info['exploders'] = exploders
            candidates.append(info)
    
    # طباعة الـ candidates
    if candidates:
        print()
        print(f'  📊 PRICE HISTORY CANDIDATES in {db_name}: {len(candidates)}')
        for c in candidates:
            print(f'     ── {c["table"]}: {c["rows"]:,} rows')
            print(f'        ticker_col={c["ticker_col"]}  date_col={c["date_col"]}  price_col={c["price_col"]}')
            print(f'        Exploders:')
            for t, e in c['exploders'].items():
                if e['rows'] > 0:
                    print(f'          {t:6s}: {e["rows"]:6d} rows  {e["first"]} → {e["last"]}')
                else:
                    print(f'          {t:6s}: {e["rows"]:6d} rows  (missing)')
    else:
        print(f'  (no price history candidates in {db_name})')
    
    conn.close()
    return summary


def main():
    target = sys.argv[1].lower() if len(sys.argv) > 1 else 'all'
    
    section('DEEP DB AUDIT — البحث عن جدول أسعار تاريخية')
    print(f'  Project root: {PROJECT_ROOT}')
    print(f'  DB dir:       {DB_DIR}')
    print(f'  Exploder tickers: {EXLODER_TICKERS}')
    print(f'  Target: {target}')
    
    if target == 'all':
        results = []
        for db_name in ALL_DBS:
            r = audit_db(db_name, verbose=True)
            if r:
                results.append(r)
        
        # ملخص نهائي: كل الـ candidates من كل الـ DBs
        section('FINAL SUMMARY: ALL PRICE HISTORY CANDIDATES')
        for r in results:
            for t in r['tables']:
                if t.get('type') == 'PRICE_HISTORY_CANDIDATE' and t['rows'] > 0:
                    db_name = r['db']
                    print(f'  📊 {db_name}.{t["table"]}: {t["rows"]:,} rows')
                    print(f'     ticker_col={t["ticker_col"]}  date_col={t["date_col"]}  price_col={t["price_col"]}')
                    exploder_total = sum(e['rows'] for e in t.get('exploders', {}).values())
                    if exploder_total > 0:
                        print(f'     Exploders found: {exploder_total} rows across 7 tickers')
                        for et, e in t.get('exploders', {}).items():
                            if e['rows'] > 0:
                                print(f'       {et}: {e["rows"]} rows ({e["first"]} → {e["last"]})')
                    print()
    else:
        # خريطة alias
        alias = {
            'data_engine': 'data_engine.db',
            'price_history': 'price_history.db',
            'stocks': 'stocks.db',
            'market': 'market.db',
            'predictions': 'predictions.db',
            'auth': 'auth.db',
            'content': 'content.db',
            'crypto': 'crypto.db',
            'macro': 'macro.db',
            'intraday': 'intraday.db',
            'news': 'news.db',
            'telegram_data': 'telegram_data.db',
        }
        db_name = alias.get(target, target)
        audit_db(db_name, verbose=True)
    
    print()
    print('=' * 78)
    print('  DEEP AUDIT COMPLETE — READ-ONLY (no DB writes)')
    print('=' * 78)


if __name__ == '__main__':
    main()
