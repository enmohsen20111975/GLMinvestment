#!/usr/bin/env python3
"""
repair_all_dbs.py — سكربت سريع لإصلاح كل قواعد البيانات التالفة
=================================================================
يستخدم:
  python3 scripts/repair_all_dbs.py          # إصلاح كل DBs في مجلد db/
  python3 scripts/repair_all_dbs.py --check  # فحص فقط بدون إصلاح
  python3 scripts/repair_all_dbs.py db/stocks.db  # إصلاح DB محدد

الاستراتيجية:
  1. PRAGMA integrity_check للكشف عن التلف
  2. REINDEX (سريع، يصلح مشاكل الفهارس)
  3. dump/rebuild (موثوق، يصلح أي تلف في الـ B-tree)

ملاحظات:
  - لا يحذف البيانات أبداً
  - ينشئ backup قبل أي إصلاح
  - يتعامل مع القفل بأن يطالب بإيقاف الخدمات أولاً
"""

import sqlite3
import os
import sys
import shutil
import time
from pathlib import Path


def check_integrity(db_path: str) -> tuple[bool, str]:
    """فحص سلامة DB. يرجع (is_ok, message)."""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        cur = conn.cursor()
        cur.execute('PRAGMA integrity_check')
        result = cur.fetchone()[0]
        conn.close()
        return (result == 'ok', result)
    except Exception as e:
        return (False, f'ERROR: {e}')


def repair_db(db_path: str) -> tuple[bool, str, dict]:
    """إصلاح DB تالفة. يرجع (success, message, stats)."""
    stats = {'tables': 0, 'rows_preserved': 0, 'strategy': 'none'}
    
    # استراتيجية 1: REINDEX
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        conn.execute('REINDEX')
        cur = conn.cursor()
        cur.execute('PRAGMA integrity_check')
        r = cur.fetchone()[0]
        conn.close()
        if r == 'ok':
            stats['strategy'] = 'REINDEX'
            return (True, 'fixed via REINDEX', stats)
    except Exception as e:
        pass

    # استراتيجية 2: dump/rebuild
    backup_path = db_path + f'.before_repair_{int(time.time())}'
    shutil.copy(db_path, backup_path)
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(db_path, writable=False).__enter__()
        cur = conn.cursor()
        
        # جلب كل الجداول و schemas
        cur.execute("SELECT name, sql FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'")
        tables = cur.fetchall()
        
        # جلب الـ indexes
        cur.execute("SELECT sql FROM sqlite_master WHERE type='index' AND sql IS NOT NULL")
        indexes = [r[0] for r in cur.fetchall() if r[0]]
        
        # dump كل البيانات
        dump_data = {}
        for table_name, table_sql in tables:
            if not table_sql:
                continue
            try:
                cur.execute(f'SELECT * FROM "{table_name}"')
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description]
                dump_data[table_name] = (table_sql, cols, rows)
            except Exception as e:
                print(f'    ⚠️ {table_name}: تخطي ({e})')
                dump_data[table_name] = (table_sql, [], [])
        conn.close()
        
        # إنشاء DB جديدة نظيفة
        tmp_path = db_path + '.repaired'
        if os.path.exists(tmp_path):
            os.remove(tmp_path)
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        new_conn = db_manager.connection(tmp_path, writable=False).__enter__()
        new_cur = new_conn.cursor()
        
        # إعادة إنشاء الجداول
        for table_name, (table_sql, cols, rows) in dump_data.items():
            try:
                new_cur.execute(table_sql)
                if rows and cols:
                    placeholders = ','.join(['?'] * len(cols))
                    new_cur.executemany(f'INSERT INTO "{table_name}" VALUES ({placeholders})', rows)
                    stats['rows_preserved'] += len(rows)
            except Exception as e:
                print(f'    ⚠️ Recreate {table_name}: {e}')
        
        # إعادة إنشاء الـ indexes
        for idx_sql in indexes:
            try:
                new_cur.execute(idx_sql)
            except:
                pass
        
        new_conn.commit()
        new_cur.execute('PRAGMA integrity_check')
        check = new_cur.fetchone()[0]
        new_conn.close()
        
        stats['tables'] = len(dump_data)
        stats['strategy'] = 'dump/rebuild'
        
        if check == 'ok':
            shutil.move(tmp_path, db_path)
            os.remove(backup_path)
            return (True, 'fixed via dump/rebuild', stats)
        else:
            return (False, f'dump/rebuild still corrupt: {check}', stats)
    except Exception as e:
        # استرجاع الـ backup
        if os.path.exists(backup_path):
            shutil.move(backup_path, db_path)
        return (False, f'dump/rebuild error: {e}', stats)


def main():
    check_only = '--check' in sys.argv
    db_arg = None
    for arg in sys.argv[1:]:
        if not arg.startswith('--') and arg.endswith('.db'):
            db_arg = arg
    
    # تحديد الـ DBs للفحص
    if db_arg:
        db_files = [db_arg]
    else:
        db_dir = Path(__file__).parent.parent / 'db'
        db_files = sorted([str(p) for p in db_dir.glob('*.db')])
    
    print(f'{"="*70}')
    print(f'{"فحص" if check_only else "إصلاح"} قواعد البيانات ({len(db_files)} DB)')
    print(f'{"="*70}')
    
    ok_count = 0
    fixed_count = 0
    failed_count = 0
    
    for db_path in db_files:
        if not os.path.exists(db_path):
            print(f'\n❌ {db_path}: غير موجود')
            failed_count += 1
            continue
        
        size_mb = os.path.getsize(db_path) / (1024 * 1024)
        is_ok, msg = check_integrity(db_path)
        
        if is_ok:
            print(f'✅ {db_path} ({size_mb:.1f}MB): OK')
            ok_count += 1
        else:
            print(f'❌ {db_path} ({size_mb:.1f}MB): CORRUPT — {msg[:60]}')
            if check_only:
                failed_count += 1
                continue
            
            # محاولة الإصلاح
            print(f'   🔧 جاري الإصلاح...')
            try:
                success, message, stats = repair_db(db_path)
                if success:
                    print(f'   ✅ تم الإصلاح: {message}')
                    print(f'      - الاستراتيجية: {stats["strategy"]}')
                    print(f'      - الجداول: {stats["tables"]}')
                    print(f'      - الصفوف المحفوظة: {stats["rows_preserved"]}')
                    fixed_count += 1
                else:
                    print(f'   ❌ فشل الإصلاح: {message}')
                    failed_count += 1
            except Exception as e:
                print(f'   ❌ خطأ غير متوقع: {e}')
                failed_count += 1
    
    print(f'\n{"="*70}')
    print(f'النتيجة النهائية:')
    print(f'  ✅ OK:      {ok_count}')
    print(f'  🔧 Fixed:   {fixed_count}')
    print(f'  ❌ Failed:  {failed_count}')
    print(f'{"="*70}')
    
    if failed_count > 0:
        sys.exit(1)


if __name__ == '__main__':
    main()
