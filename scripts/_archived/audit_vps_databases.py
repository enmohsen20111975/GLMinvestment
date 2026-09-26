#!/usr/bin/env python3
"""
audit_vps_databases.py
======================
سكربت تدقيق شامل لقواعد بيانات السيرفر الإنتاجي.

الهدف: يطبع لك/للمبرمج الخريطة الكاملة لكل قواعد البيانات الموجودة
على الـ VPS، كل جداولها، عدد الصفوف، ومخططات الجداول السعرية، عشان
نعرف بالظبط فين الداتا الحقيقية اللي سكربت الباك-تست لازم يقرأ منها.

التشغيل على السيرفر:
    cd /root/GLMinvestment   (أو مسار المشروع)
    git pull origin main
    python3 scripts/audit_vps_databases.py

    # لو حابب تحفظ المخرجات لملف:
    python3 scripts/audit_vps_databases.py > /tmp/vps_db_audit.txt 2>&1
    cat /tmp/vps_db_audit.txt   # انسخ المحتوى وابعه للمبرمج
"""
from __future__ import annotations

import os
import sqlite3
import sys
from pathlib import Path
from datetime import datetime

# ─── candidate project roots ───────────────────────────────────────────────
CANDIDATE_ROOTS = [
    Path('/root/GLMinvestment'),
    Path('/root/glminvestment'),
    Path('/home/z/my-project'),
    Path.cwd(),
    Path.cwd().parent,
]


def _safe_is_dir(p: Path) -> bool:
    try:
        return p.is_dir()
    except (PermissionError, OSError):
        return False


def find_project_root() -> Path:
    for r in CANDIDATE_ROOTS:
        if _safe_is_dir(r / 'db') or _safe_is_dir(r / 'vps-service'):
            return r
    return Path.cwd()


def find_all_dbs(root: Path) -> list:
    """Find every .db / .sqlite file under root (excluding node_modules/.next)."""
    dbs = []
    skip_dirs = {'node_modules', '.next', '.git', '__pycache__', '.cache'}
    for p in root.rglob('*.db'):
        if any(part in skip_dirs for part in p.parts):
            continue
        dbs.append(p)
    for p in root.rglob('*.sqlite'):
        if any(part in skip_dirs for part in p.parts):
            continue
        dbs.append(p)
    for p in root.rglob('*.sqlite3'):
        if any(part in skip_dirs for part in p.parts):
            continue
        dbs.append(p)
    # dedupe + sort
    seen = set()
    out = []
    for p in dbs:
        rp = p.resolve()
        if rp not in seen:
            seen.add(rp)
            out.append(p)
    return sorted(out)


def safe_query(conn, sql, args=()):
    try:
        cur = conn.execute(sql, args)
        return cur.fetchall()
    except Exception as e:
        return [('__ERROR__', str(e))]


def audit_db(db_path: Path) -> dict:
    """Audit one DB file: tables, row counts, schemas."""
    info = {
        'path': str(db_path),
        'size_kb': db_path.stat().st_size // 1024 if db_path.exists() else 0,
        'tables': [],
        'errors': [],
    }
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
    except Exception as e:
        info['errors'].append(f'Cannot open DB: {e}')
        return info

    try:
        tables = conn.execute(
            "SELECT name, type FROM sqlite_master WHERE type IN ('table','view') "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        for t in tables:
            tname = t['name']
            ttype = t['type']
            # row count
            try:
                cnt = conn.execute(f'SELECT COUNT(*) FROM "{tname}"').fetchone()[0]
            except Exception as e:
                cnt = -1
            # schema (columns)
            try:
                cols = conn.execute(f'PRAGMA table_info("{tname}")').fetchall()
                col_info = [(c['name'], c['type'], c['notnull']) for c in cols]
            except Exception:
                col_info = []
            info['tables'].append({
                'name': tname,
                'type': ttype,
                'rows': cnt,
                'columns': col_info,
            })
        conn.close()
    except Exception as e:
        info['errors'].append(f'Audit error: {e}')
        try:
            conn.close()
        except Exception:
            pass
    return info


def audit_price_table(db_path: Path, table: str) -> dict:
    """Deep audit of a price/history table: schema, date range, ticker count, sample."""
    out = {'db': str(db_path), 'table': table}
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        # schema
        cols = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
        col_names = [c['name'] for c in cols]
        out['columns'] = col_names

        # find likely date column
        date_col = None
        for cand in ('price_date', 'date', 'trade_date', 'dt', 'day', 'timestamp'):
            if cand in col_names:
                date_col = cand
                break
        # find likely ticker column
        ticker_col = None
        for cand in ('ticker', 'symbol', 'stock', 'stock_symbol'):
            if cand in col_names:
                ticker_col = cand
                break
        # find likely close price column
        close_col = None
        for cand in ('close_price', 'close', 'last_price', 'adj_close'):
            if cand in col_names:
                close_col = cand
                break

        out['date_col'] = date_col
        out['ticker_col'] = ticker_col
        out['close_col'] = close_col

        # row count
        try:
            out['rows'] = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        except Exception as e:
            out['rows'] = f'ERR: {e}'

        # date range
        if date_col:
            try:
                r = conn.execute(
                    f'SELECT MIN("{date_col}"), MAX("{date_col}"), COUNT(DISTINCT "{date_col}") FROM "{table}"'
                ).fetchone()
                out['date_min'] = r[0]
                out['date_max'] = r[1]
                out['distinct_dates'] = r[2]
            except Exception as e:
                out['date_range_err'] = str(e)
            # unique tickers
            if ticker_col:
                try:
                    r = conn.execute(
                        f'SELECT COUNT(DISTINCT "{ticker_col}") FROM "{table}"'
                    ).fetchone()
                    out['unique_tickers'] = r[0]
                    # top 10 tickers by row count
                    top = conn.execute(
                        f'SELECT "{ticker_col}", COUNT(*) as c FROM "{table}" '
                        f'GROUP BY "{ticker_col}" ORDER BY c DESC LIMIT 10'
                    ).fetchall()
                    out['top_tickers'] = [(row[0], row[1]) for row in top]
                except Exception as e:
                    out['ticker_err'] = str(e)

        # sample 3 rows
        try:
            sample = conn.execute(f'SELECT * FROM "{table}" LIMIT 3').fetchall()
            out['sample_rows'] = [dict(r) for r in sample]
        except Exception as e:
            out['sample_err'] = str(e)

        conn.close()
    except Exception as e:
        out['err'] = str(e)
    return out


def is_price_table(tname: str) -> bool:
    low = tname.lower()
    keywords = ('price', 'daily', 'history', 'candle', 'ohlc', 'quote', 'bar')
    return any(k in low for k in keywords)


def is_stock_list_table(tname: str) -> bool:
    low = tname.lower()
    keywords = ('stock', 'ticker', 'symbol', 'egksco', 'instrument', 'security')
    return any(k in low for k in keywords)


def main():
    root = find_project_root()
    print('=' * 78)
    print('  VPS DATABASE AUDIT — الخريطة الكاملة لقواعد البيانات')
    print('=' * 78)
    print(f'  Project root: {root}')
    print(f'  Timestamp:    {datetime.now().isoformat(timespec="seconds")}')
    print(f'  Python:       {sys.version.split()[0]}')
    print()

    dbs = find_all_dbs(root)
    if not dbs:
        print('⚠ لا توجد قواعد بيانات .db / .sqlite في المشروع!')
        print(f'  تم البحث في: {root}')
        return

    print(f'✓ تم العثور على {len(dbs)} قاعدة بيانات:')
    for db in dbs:
        sz = db.stat().st_size
        sz_str = f'{sz//1024} KB' if sz < 1024*1024 else f'{sz/1024/1024:.1f} MB'
        print(f'    • {db}  ({sz_str})')
    print()
    print('═' * 78)
    print()

    # ─── per-DB audit ──────────────────────────────────────────────────────
    price_tables_found = []
    stock_list_tables_found = []

    for db in dbs:
        info = audit_db(db)
        print(f'◆ DB: {db}  ({info["size_kb"]} KB)')
        if info['errors']:
            for e in info['errors']:
                print(f'  ⚠ {e}')
        if not info['tables']:
            print('  (لا توجد جداول)')
            print()
            continue
        print(f'  الجداول ({len(info["tables"])}):')
        for t in info['tables']:
            tag = ''
            if is_price_table(t['name']):
                tag = '  ← PRICE'
                price_tables_found.append((db, t['name']))
            elif is_stock_list_table(t['name']):
                tag = '  ← STOCKS'
                stock_list_tables_found.append((db, t['name']))
            print(f"    [{t['type']:5}] {t['name']:<45} rows={t['rows']:>10}{tag}")
        print()

    # ─── deep audit of price tables ────────────────────────────────────────
    print('═' * 78)
    print('  تدقيق عميق — الجداول السعرية (الأهم للباك-تست)')
    print('═' * 78)
    if not price_tables_found:
        print('⚠ لم يتم العثور على أي جداول أسعار! ابحث يدوياً عن جداول فيها OHLCV.')
    else:
        for db, table in price_tables_found:
            print()
            print(f'◆ PRICE TABLE: {table}  (in {db.name})')
            d = audit_price_table(db, table)
            for k, v in d.items():
                if k in ('sample_rows',):
                    print(f'  {k}:')
                    for row in v:
                        print(f'      {row}')
                elif k in ('top_tickers',):
                    print(f'  {k}:')
                    for t, c in v:
                        print(f'      {t}: {c} rows')
                else:
                    print(f'  {k}: {v}')
    print()

    # ─── deep audit of stock list tables ───────────────────────────────────
    print('═' * 78)
    print('  تدقيق عميق — جداول قوائم الأسهم')
    print('═' * 78)
    if not stock_list_tables_found:
        print('⚠ لم يتم العثور على جداول قوائم أسهم.')
    else:
        for db, table in stock_list_tables_found:
            print()
            print(f'◆ STOCK LIST: {table}  (in {db.name})')
            try:
                conn = sqlite3.connect(str(db))
                conn.row_factory = sqlite3.Row
                cols = [c['name'] for c in conn.execute(f'PRAGMA table_info("{table}")').fetchall()]
                print(f'  columns: {cols}')
                cnt = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
                print(f'  rows: {cnt}')
                # sample
                sample = conn.execute(f'SELECT * FROM "{table}" LIMIT 5').fetchall()
                print(f'  sample:')
                for r in sample:
                    print(f'      {dict(r)}')
                # sector distribution if a sector column exists
                sec_col = None
                for c in ('sector', 'industry', 'sub_sector', 'category'):
                    if c in cols:
                        sec_col = c
                        break
                if sec_col:
                    print(f'  sector distribution (top 15):')
                    dist = conn.execute(
                        f'SELECT "{sec_col}", COUNT(*) as c FROM "{table}" '
                        f'GROUP BY "{sec_col}" ORDER BY c DESC LIMIT 15'
                    ).fetchall()
                    for r in dist:
                        print(f'      {r[0]}: {r[1]}')
                conn.close()
            except Exception as e:
                print(f'  ⚠ ERR: {e}')
    print()

    # ─── summary ───────────────────────────────────────────────────────────
    print('═' * 78)
    print('  الملخص النهائي')
    print('═' * 78)
    print(f'  Total DB files:        {len(dbs)}')
    print(f'  Price tables found:    {len(price_tables_found)}')
    for db, t in price_tables_found:
        print(f'    • {db.name} :: {t}')
    print(f'  Stock-list tables:     {len(stock_list_tables_found)}')
    for db, t in stock_list_tables_found:
        print(f'    • {db.name} :: {t}')
    print()
    print('  انسخ المخرجات دي كلها وابعتها للمبرمج عشان يكيّف سكربت الباك-تست.')
    print('═' * 78)


if __name__ == '__main__':
    main()
