#!/usr/bin/env python3
"""
export_vps_data_for_sandbox.py
==============================
سكربت تصدير آمن لبيانات السيرفر الإنتاجي → JSON files (مش .db).

السبب: .gitignore بيمنع رفع .db files (قاعدة المالك الصارمة: ممنوع
نشر قواعد البيانات على GitHub). لكننا محتاجين الداتا الحقيقية في
الساندبوكس عشان نـ backtest عليها. الحل: نـ dump الـ tables المهمة
لـ JSON files (مسموح بيها في git) ونرفعها.

الـ JSON files اللي بيتولدها (في db/export/):
  - egksco_stocks.json          → قائمة الأسهم الحقيقية (symbol + sector + prices)
  - stock_daily_prices.json     → الأسعار اليومية التاريخية (الأهم للباك-تست)
  - egksco_price_history.json   → مصدر بديل للأسعار (لو stock_daily_prices فاضي)
  - intraday_prices.json        → أسعار intraday (لو موجودة)
  - predictions.json            → التوصيات السابقة (لـ closed-loop learning)
  - market_indices.json         → مؤشرات السوق (لـ regime detection)
  - macro_indicators.json       → المؤشرات الكلية
  - _manifest.json              → ملخص (عدد الصفوف + تواريخ) لكل ملف

التشغيل على السيرفر:
    cd /root/GLMinvestment
    git pull origin main
    python3 scripts/export_vps_data_for_sandbox.py

    # بعدها:
    git add db/export/*.json
    git commit -m "[P0-v8-DATA-EXPORT] Real VPS data dump for sandbox backtest"
    git push origin main

ملحوظة: الـ JSON files دي بتتحط في db/export/ اللي مش ممنوع في .gitignore.
"""
from __future__ import annotations

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

# ─── paths ─────────────────────────────────────────────────────────────────
_ROOT = Path(__file__).resolve().parent.parent
_DB_DIR = _ROOT / 'db'
_EXPORT_DIR = _DB_DIR / 'export'
_EXPORT_DIR.mkdir(parents=True, exist_ok=True)

# DBs to audit + tables to export (table_name → json_filename)
# order matters: first non-empty source wins for price history
EXPORT_PLAN = [
    {
        'db': 'stocks.db',
        'tables': {
            'egksco_stocks': 'egksco_stocks.json',
            'stock_daily_prices': 'stock_daily_prices.json',
            'egksco_price_history': 'egksco_price_history.json',
            'stock_adaptive_profiles': 'stock_adaptive_profiles.json',
            'market_indices': 'market_indices.json',
            'market_regime_log': 'market_regime_log.json',
            'macro_indicators': 'macro_indicators.json',
            'stocks': 'stocks_legacy.json',
        },
    },
    {
        'db': 'data_engine.db',
        'tables': {
            'egksco_price_history': 'data_engine_egksco_price_history.json',
            'egksco_stocks': 'data_engine_egksco_stocks.json',
            'egx_fundamentals': 'egx_fundamentals.json',
            'tab_balance_sheet': 'tab_balance_sheet.json',
            'tab_profitability': 'tab_profitability.json',
            'tab_valuation': 'tab_valuation.json',
        },
    },
    {
        'db': 'intraday.db',
        'tables': {
            'intraday_prices': 'intraday_prices.json',
        },
    },
    {
        'db': 'predictions.db',
        'tables': {
            'predictions': 'predictions.json',
            'prediction_outcomes': 'prediction_outcomes.json',
            'learned_lessons': 'learned_lessons.json',
            'stored_analyses': 'stored_analyses.json',
            'persona_predictions': 'persona_predictions.json',
            'optimizer_params_history': 'optimizer_params_history.json',
            'crypto_predictions_log': 'crypto_predictions_log.json',
        },
    },
    {
        'db': 'price_history.db',
        'tables': {},  # will auto-discover tables
    },
]

# cap rows per table to avoid massive JSON (1M rows = ~150MB JSON)
MAX_ROWS_PER_TABLE = 200_000


def _json_safe(v):
    """Convert sqlite values to JSON-safe types."""
    if isinstance(v, bytes):
        return v.decode('utf-8', errors='replace')[:200]
    if isinstance(v, (int, float, str, bool)) or v is None:
        return v
    return str(v)


def discover_tables(db_path: Path) -> list:
    """Return list of (table_name, row_count) for a DB."""
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        rows = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        ).fetchall()
        out = []
        for r in rows:
            tname = r['name']
            try:
                cnt = conn.execute(f'SELECT COUNT(*) FROM "{tname}"').fetchone()[0]
            except Exception:
                cnt = -1
            out.append((tname, cnt))
        conn.close()
        return out
    except Exception as e:
        print(f'  ⚠ discover_tables({db_path.name}) failed: {e}')
        return []


def export_table(db_path: Path, table: str, out_file: Path) -> dict:
    """Export one table to JSON. Returns manifest entry."""
    manifest = {'table': table, 'db': db_path.name, 'rows_exported': 0,
                'truncated': False, 'columns': [], 'date_range': None,
                'error': None}
    try:
        conn = sqlite3.connect(str(db_path))
        conn.row_factory = sqlite3.Row
        # get columns
        cols_info = conn.execute(f'PRAGMA table_info("{table}")').fetchall()
        col_names = [c['name'] for c in cols_info]
        manifest['columns'] = col_names

        # count rows
        try:
            total = conn.execute(f'SELECT COUNT(*) FROM "{table}"').fetchone()[0]
        except Exception:
            total = 0
        manifest['rows_total'] = total

        if total == 0:
            conn.close()
            return manifest

        # detect date column for range
        date_col = None
        for cand in ('price_date', 'date', 'trade_date', 'dt', 'day', 'timestamp',
                     'created_at', 'prediction_date'):
            if cand in col_names:
                date_col = cand
                break
        if date_col:
            try:
                r = conn.execute(
                    f'SELECT MIN("{date_col}"), MAX("{date_col}") FROM "{table}"'
                ).fetchone()
                manifest['date_range'] = [r[0], r[1]]
            except Exception:
                pass

        # fetch rows (capped)
        limit = min(total, MAX_ROWS_PER_TABLE)
        if total > MAX_ROWS_PER_TABLE:
            manifest['truncated'] = True

        rows = conn.execute(f'SELECT * FROM "{table}" LIMIT {limit}').fetchall()
        data = [{k: _json_safe(row[k]) for k in col_names} for row in rows]

        with open(out_file, 'w', encoding='utf-8') as f:
            json.dump({
                'table': table,
                'source_db': db_path.name,
                'exported_at': datetime.now().isoformat(timespec='seconds'),
                'columns': col_names,
                'row_count': len(data),
                'truncated': manifest['truncated'],
                'total_rows_in_db': total,
                'date_range': manifest['date_range'],
                'rows': data,
            }, f, ensure_ascii=False, default=str)

        manifest['rows_exported'] = len(data)
        conn.close()
    except Exception as e:
        manifest['error'] = str(e)
    return manifest


def main():
    print('=' * 78)
    print('  VPS DATA EXPORT → JSON  (آمن للرفع على GitHub)')
    print('=' * 78)
    print(f'  Output dir: {_EXPORT_DIR}')
    print()

    manifest_all = {
        'exported_at': datetime.now().isoformat(timespec='seconds'),
        'host': os.uname().nodename if hasattr(os, 'uname') else 'unknown',
        'dbs': [],
    }

    for plan in EXPORT_PLAN:
        db_name = plan['db']
        db_path = _DB_DIR / db_name
        print(f'◆ DB: {db_name}')
        if not db_path.exists():
            print(f'  ⚠ Not found: {db_path}')
            continue
        sz = db_path.stat().st_size
        sz_str = f'{sz/1024:.1f} KB' if sz < 1024*1024 else f'{sz/1024/1024:.2f} MB'
        print(f'  size: {sz_str}')

        # if no tables planned, auto-discover
        tables_to_export = plan.get('tables', {})
        if not tables_to_export:
            discovered = discover_tables(db_path)
            for tname, cnt in discovered:
                if cnt > 0:
                    safe_name = f'{db_name.replace(".db","")}_{tname}.json'
                    tables_to_export[tname] = safe_name
            if tables_to_export:
                print(f'  auto-discovered {len(tables_to_export)} non-empty tables')

        db_manifest = {'db': db_name, 'size_bytes': sz, 'tables': []}
        for table, out_name in tables_to_export.items():
            out_file = _EXPORT_DIR / out_name
            m = export_table(db_path, table, out_file)
            status = '✓' if m['rows_exported'] > 0 else '∅ (empty)'
            if m.get('error'):
                status = f'⚠ ERR: {m["error"][:50]}'
            date_str = ''
            if m.get('date_range'):
                date_str = f'  dates: {m["date_range"][0]} → {m["date_range"][1]}'
            print(f'  {status} {table:<40} → {out_name}  '
                  f'({m["rows_exported"]:,} rows{(" of "+str(m.get("rows_total",0))) if m["truncated"] else ""}){date_str}')
            db_manifest['tables'].append({
                'table': table,
                'out_file': out_name,
                'rows_exported': m['rows_exported'],
                'total_rows': m.get('rows_total', 0),
                'truncated': m['truncated'],
                'date_range': m.get('date_range'),
                'error': m.get('error'),
                'columns': m.get('columns', []),
            })
        manifest_all['dbs'].append(db_manifest)
        print()

    # write manifest
    manifest_file = _EXPORT_DIR / '_manifest.json'
    with open(manifest_file, 'w', encoding='utf-8') as f:
        json.dump(manifest_all, f, indent=2, ensure_ascii=False, default=str)
    print(f'✓ Manifest written: {manifest_file}')
    print()

    # summary
    total_files = sum(len(d['tables']) for d in manifest_all['dbs'])
    total_rows = sum(t['rows_exported'] for d in manifest_all['dbs'] for t in d['tables'])
    print('═' * 78)
    print('  الملخص')
    print('═' * 78)
    print(f'  DBs audited:        {len(manifest_all["dbs"])}')
    print(f'  Tables exported:    {total_files}')
    print(f'  Total rows dumped:  {total_rows:,}')
    print(f'  Output dir:         {_EXPORT_DIR}')
    print()
    print('  الخطوة التالية (على السيرفر):')
    print('    git add db/export/*.json')
    print('    git commit -m "[P0-v8-DATA-EXPORT] Real VPS data dump for sandbox backtest"')
    print('    git push origin main')
    print()
    print('  بعدها في الساندبوكس: git pull → الباك-تست هيقرأ الـ JSON تلقائياً.')
    print('═' * 78)


if __name__ == '__main__':
    main()
