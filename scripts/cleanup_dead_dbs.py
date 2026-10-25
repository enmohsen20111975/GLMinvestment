#!/usr/bin/env python3
"""
سكربت تنظيف شامل — ينظف DBs الميتة + الجداول غير المستخدمة
==========================================================
Owner: "قلل قواعد البيانات... وسجل الحاجات الى ملهاش لزمة وفى الأخر نعمل سكربت ينظف الدنيا"

شغّل: python3 scripts/cleanup_dead_dbs.py

المهام:
1. فحص كل DBs في db/ وعرض حجمها + عدد الجداول
2. تحديد DBs ميتة (0 rows أو مش مستخدمة في الكود)
3. تحديد جداول ميتة داخل DBs نشطة
4. عرض تقرير بدون مسح (dry-run) — المالك يراجع ويوافق
"""
import os
import sqlite3
from pathlib import Path
from collections import defaultdict

DB_DIR = Path(__file__).resolve().parents[1] / 'db'

def analyze_db(db_path):
    """تحليل DB: حجمه + جداوله + عدد الصفوف."""
    result = {'name': db_path.name, 'size_mb': 0, 'tables': {}, 'total_rows': 0}
    try:
        result['size_mb'] = round(db_path.stat().st_size / 1024 / 1024, 1)
    except:
        result['size_mb'] = 0
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(db_path), writable=False).__enter__()
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()]
        for t in tables:
            try:
                cnt = conn.execute(f'SELECT COUNT(*) FROM "{t}"').fetchone()[0]
                result['tables'][t] = cnt
                result['total_rows'] += cnt
            except:
                result['tables'][t] = -1  # error reading
        conn.close()
    except Exception as e:
        result['error'] = str(e)
    
    return result

def main():
    print("=" * 100)
    print("🧹 سكربت التنظيف الشامل — فحص DBs + جداول ميتة")
    print("=" * 100)
    
    dbs = sorted(DB_DIR.glob('*.db'))
    print(f"\n📦 {len(dbs)} DBs موجودة في db/:")
    print(f"{'DB Name':30s} | {'Size':>8s} | {'Tables':>7s} | {'Total Rows':>12s} | Status")
    print("-" * 100)
    
    all_results = []
    for db in dbs:
        info = analyze_db(db)
        all_results.append(info)
        status = '✅ نشط' if info['total_rows'] > 0 else '❌ ميت'
        if 'error' in info:
            status = '⚠️ خطأ'
        print(f"{info['name']:30s} | {info['size_mb']:>6.1f}MB | {len(info['tables']):>7d} | {info['total_rows']:>12d} | {status}")
    
    # تحديد DBs ميتة
    dead_dbs = [r for r in all_results if r['total_rows'] == 0 and 'error' not in r]
    if dead_dbs:
        print(f"\n🗑️ DBs ميتة (0 rows) — قابلة للحذف:")
        for r in dead_dbs:
            print(f"  ❌ {r['name']:30s} | {r['size_mb']:.1f}MB | {len(r['tables'])} tables")
    
    # تحديد جداول ميتة في DBs نشطة
    dead_tables = []
    for r in all_results:
        if r['total_rows'] > 0 and 'error' not in r:
            for t, cnt in r['tables'].items():
                if cnt == 0:
                    dead_tables.append((r['name'], t))
    
    if dead_tables:
        print(f"\n🗑️ جداول ميتة (0 rows) داخل DBs نشطة:")
        for db_name, table_name in dead_tables:
            print(f"  ❌ {db_name:20s} → {table_name}")
    
    # DBs صغيرة جداً (محتمل تكون مش مهمة)
    tiny_dbs = [r for r in all_results if 0 < r['size_mb'] < 0.1 and r['name'] not in 
                ('auth.db', 'learned.db', 'analytics.db', 'community.db')]
    if tiny_dbs:
        print(f"\n⚠️ DBs صغيرة جداً (< 100KB) — مراجعة:")
        for r in tiny_dbs:
            print(f"  ⚠️ {r['name']:30s} | {r['size_mb']:.2f}MB | {r['total_rows']} rows")
    
    # ملخص
    total_size = sum(r['size_mb'] for r in all_results)
    dead_size = sum(r['size_mb'] for r in dead_dbs)
    print(f"\n{'='*100}")
    print(f"📊 ملخص:")
    print(f"  إجمالي DBs: {len(dbs)} | حجم كلي: {total_size:.1f}MB")
    print(f"  DBs ميتة: {len(dead_dbs)} | حجم يمكن توفيره: {dead_size:.1f}MB")
    print(f"  جداول ميتة: {len(dead_tables)}")
    print(f"\n💡 للحذف الفعلي: راجع القائمة دي ووافق على الحذف.")
    print(f"   السكربت ده dry-run فقط — ما بيمسحش حاجة.")
    
    # price_history.db خاص
    ph = DB_DIR / 'price_history.db'
    if ph.exists():
        ph_info = analyze_db(ph)
        print(f"\n🚫 price_history.db: {ph_info['size_mb']:.1f}MB — تم إلغاؤه في الكود (2026-09-03)")
        print(f"   يمكن حذفه بأمان: rm db/price_history.db")

if __name__ == '__main__':
    main()
