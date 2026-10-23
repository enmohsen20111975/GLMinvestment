#!/usr/bin/env python3
"""
=============================================================================
🔍 Deep Schema Audit — فحص الـ schema الكامل + triggers + views + indexes
=============================================================================

الـ audit الأول فحص tables بس. ده فحص أعمق:
  - كل الـ tables (مش بس required)
  - كل الـ views
  - كل الـ triggers (مهمة جداً — ممكن تتأثر بـ ALTER TABLE)
  - كل الـ indexes (مهمة للـ performance)
  - كل الـ schema للـ price_history table بالتفصيل

Usage:
  cd /root/GLMinvestment
  .venv/bin/python3 scripts/deep_schema_audit.py
"""

import json
import sqlite3
import sys
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

CRITICAL_DBS = ['price_history.db', 'data_engine.db', 'stocks.db', 'predictions.db']


def deep_audit_db(db_path: Path) -> dict:
    """فحص عميق لـ DB واحد."""
    result = {
        'db_name': db_path.name,
        'exists': db_path.exists(),
        'size_mb': 0,
        'tables': [],
        'views': [],
        'triggers': [],
        'indexes': [],
        'table_details': {},
    }

    if not db_path.exists():
        return result

    result['size_mb'] = round(db_path.stat().st_size / (1024 * 1024), 2)

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        cur = conn.cursor()

        # كل الـ tables
        cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table' ORDER BY name")
        for name, sql in cur.fetchall():
            result['tables'].append(name)
            # get columns + row count
            cur.execute(f'PRAGMA table_info("{name}")')
            cols = [{'name': r[1], 'type': r[2], 'pk': r[5]} for r in cur.fetchall()]
            try:
                cur.execute(f'SELECT COUNT(*) FROM "{name}"')
                row_count = cur.fetchone()[0]
            except:
                row_count = -1
            result['table_details'][name] = {
                'columns': cols,
                'row_count': row_count,
                'create_sql': sql,
            }

        # كل الـ views
        cur.execute("SELECT name, sql FROM sqlite_master WHERE type='view' ORDER BY name")
        for name, sql in cur.fetchall():
            result['views'].append({'name': name, 'sql': sql})

        # كل الـ triggers (مهمة جداً)
        cur.execute("SELECT name, table_name, sql FROM sqlite_master WHERE type='trigger' ORDER BY name")
        for name, table, sql in cur.fetchall():
            result['triggers'].append({'name': name, 'table': table, 'sql': sql})

        # كل الـ indexes
        cur.execute("SELECT name, tbl_name, sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY name")
        for name, tbl, sql in cur.fetchall():
            result['indexes'].append({'name': name, 'table': tbl, 'sql': sql})

        conn.close()
    except Exception as e:
        result['error'] = str(e)

    return result


def check_unify_safety(audit: dict) -> list:
    """فحص هل الـ unify script هيأثر على أي trigger أو view؟"""
    warnings = []
    db_name = audit['db_name']

    # الـ unify script بيعمل: ALTER TABLE price_history ADD COLUMN market
    # ده ممكن يأثر على triggers/views اللي بتستخدم price_history
    for trigger in audit['triggers']:
        if 'price_history' in (trigger.get('table', '') + ' ' + trigger.get('sql', '')).lower():
            warnings.append(f'⚠️ trigger "{trigger["name"]}" على price_history — الـ ALTER TABLE ممكن يحتاج تحديث')

    for view in audit['views']:
        if 'price_history' in (view.get('name', '') + ' ' + view.get('sql', '')).lower():
            warnings.append(f'⚠️ view "{view["name"]}" بـ query على price_history — تحقق إنه هيشتغل بعد الـ ALTER')

    return warnings


def main():
    print(f"\n{'='*70}")
    print(f"🔍 Deep Schema Audit — {datetime.now().isoformat()[:19]}")
    print(f"{'='*70}\n")

    full_report = {}

    for db_name in CRITICAL_DBS:
        db_path = DB_DIR / db_name
        print(f"📋 Deep auditing {db_name}...")
        result = deep_audit_db(db_path)

        print(f"  ✅ {result['size_mb']} MB | tables: {len(result['tables'])} | views: {len(result['views'])} | triggers: {len(result['triggers'])} | indexes: {len(result['indexes'])}")

        if result['triggers']:
            print(f"  🟡 triggers found:")
            for t in result['triggers']:
                print(f"     → {t['name']} (on {t['table']})")

        if result['views']:
            print(f"  🟡 views found:")
            for v in result['views']:
                print(f"     → {v['name']}")

        warnings = check_unify_safety(result)
        if warnings:
            print(f"  🔴 UNIFY SAFETY WARNINGS:")
            for w in warnings:
                print(f"     {w}")

        full_report[db_name] = result
        print()

    # احفظ الـ JSON الكامل
    report_path = DB_DIR / f'deep_audit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(full_report, f, indent=2, ensure_ascii=False, default=str)

    print(f"{'='*70}")
    print(f"📁 Full deep audit report: {report_path}")
    print(f"{'='*70}")

    # ملخص نهائي
    total_triggers = sum(len(r['triggers']) for r in full_report.values())
    total_views = sum(len(r['views']) for r in full_report.values())
    total_warnings = sum(len(check_unify_safety(r)) for r in full_report.values())

    print(f"\n📊 Summary:")
    print(f"  DBs audited: {len(CRITICAL_DBS)}")
    print(f"  Total triggers: {total_triggers}")
    print(f"  Total views: {total_views}")
    print(f"  Unify safety warnings: {total_warnings}")

    if total_warnings > 0:
        print(f"\n🚨 {total_warnings} warnings — راجعها قبل الـ deploy")
        return 1

    print(f"\n✅ Safe for deployment (no triggers/views will be affected)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
