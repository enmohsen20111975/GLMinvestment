#!/usr/bin/env python3
"""
فلترة توقعات الذكاء الاصطناعي - Smart Filter AI Predictions
===============================================================

المشكلة: 538,396 توقع كتير جداً
الحل: فلترة ذكية - الإبقاء على التوقعات الجيدة فقط

معايير التوقعات الجيدة:
1. حققت الهدف (target_reached = 1) ✓
2. وقف خسارة (stop_hit = 1) ✓
3. لا تزال نشطة (لها تاريخ حديث) ✓
4. ثقة عالية (confidence >= 60) ✓
5. ليست مكررة ✓

الاستخدام:
    python scripts/smart_filter_predictions.py --dry-run
    python scripts/smart_filter_predictions.py --execute
"""

import os
import sys
import sqlite3
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# مسارات قاعدة البيانات
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
POSSIBLE_DB_PATHS = [
    PROJECT_ROOT / "db" / "stocks.db",
    PROJECT_ROOT / "db" / "stocks.db",
    
    
]


def find_database():
    """البحث عن قاعدة البيانات."""
    for db_path in POSSIBLE_DB_PATHS:
        if db_path.exists():
            return db_path
    return None


def analyze_predictions(conn):
    """تحليل مفصل للتوقعات."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("📊 تحليل توقعات الذكاء الاصطناعي")
    print("="*70)

    # إجمالى التوقعات
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    total = cursor.fetchone()[0]
    print(f"\n📈 إجمالى التوقعات: {total:,}")

    if total == 0:
        return

    # 1. توزيع حسب النتيجة
    print("\n🔹 توزيع حسب النتيجة:")
    cursor.execute("""
        SELECT 
            SUM(CASE WHEN target_reached = 1 THEN 1 ELSE 0 END) as hit_target,
            SUM(CASE WHEN stop_hit = 1 THEN 1 ELSE 0 END) as stop_hit,
            SUM(CASE WHEN target_reached = 0 AND stop_hit = 0 THEN 1 ELSE 0 END) as pending
        FROM prediction_logs
    """)
    row = cursor.fetchone()
    hit_target = row[0] or 0
    stop_hit = row[1] or 0
    pending = row[2] or 0
    closed = hit_target + stop_hit
    
    print(f"   ✅ حققت الهدف: {hit_target:,}")
    print(f"   ❌ وقف خسارة: {stop_hit:,}")
    print(f"   ⏳ معلقة: {pending:,}")
    print(f"   📊 مغلقة: {closed:,}")

    if closed > 0:
        success_rate = (hit_target / closed) * 100
        print(f"   📈 معدل النجاح: {success_rate:.1f}%")

    # 2. توزيع حسب الثقة
    print("\n🔹 توزيع حسب الثقة:")
    cursor.execute("""
        SELECT 
            CASE 
                WHEN confidence >= 70 THEN 'عالية (70%+)'
                WHEN confidence >= 55 THEN 'متوسطة (55-70%)'
                WHEN confidence > 0 THEN 'منخفضة (أقل من 55%)'
                ELSE 'غير محددة'
            END as level,
            COUNT(*) as cnt
        FROM prediction_logs
        GROUP BY level
    """)
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]:,}")

    # 3. توزيع حسب التاريخ
    print("\n🔹 توزيع حسب الشهر:")
    cursor.execute("""
        SELECT substr(prediction_date, 1, 7) as month, COUNT(*) as cnt
        FROM prediction_logs
        WHERE prediction_date IS NOT NULL
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
    """)
    for row in cursor.fetchall():
        print(f"   {row[0]}: {row[1]:,}")

    # 4. التوقعات المكررة
    print("\n🔹 تحليل التكرار:")
    cursor.execute("""
        SELECT ticker, prediction_date, recommendation, COUNT(*) as cnt
        FROM prediction_logs
        GROUP BY ticker, prediction_date, recommendation
        HAVING cnt > 1
        ORDER BY cnt DESC
        LIMIT 5
    """)
    duplicates = cursor.fetchall()
    if duplicates:
        print("   أمثلة على التكرار:")
        for row in duplicates[:5]:
            print(f"      {row[0]} - {row[1]} - {row[2]}: {row[3]} مرة")
        
        cursor.execute("""
            SELECT COUNT(*) FROM (
                SELECT ticker, prediction_date, recommendation
                FROM prediction_logs
                GROUP BY ticker, prediction_date, recommendation
                HAVING COUNT(*) > 1
            )
        """)
        dup_groups = cursor.fetchone()[0]
        print(f"   عدد المجموعات المكررة: {dup_groups:,}")
    else:
        print("   ✓ لا توجد تكرارات")

    # 5. توقعات بدون بيانات مهمة
    print("\n🔹 توقعات بدون بيانات كافية:")
    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE entry_price IS NULL OR entry_price = 0
    """)
    no_entry = cursor.fetchone()[0]
    print(f"   بدون سعر دخول: {no_entry:,}")

    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE target_price IS NULL OR target_price = 0
    """)
    no_target = cursor.fetchone()[0]
    print(f"   بدون سعر هدف: {no_target:,}")

    return {
        'total': total,
        'hit_target': hit_target,
        'stop_hit': stop_hit,
        'pending': pending,
        'no_entry': no_entry,
        'no_target': no_target,
    }


def smart_filter(conn, dry_run=True):
    """فلترة ذكية للتوقعات."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("🧹 فلترة التوقعات الذكية")
    print("="*70)

    # 1. عدد التوقعات قبل الفلترة
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    before = cursor.fetchone()[0]
    print(f"\nالتوقعات قبل الفلترة: {before:,}")

    # 2. تحديد التوقعات للحذف
    print("\n🔍 تحديد التوقعات للحذف...")

    # أ. توقعات مكررة (نحتفظ بواحدة)
    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM prediction_logs
            GROUP BY ticker, prediction_date, recommendation
        )
    """)
    duplicates = cursor.fetchone()[0]
    print(f"   توقعات مكررة: {duplicates:,}")

    # ب. توقعات قديمة جداً بدون نتيجة (أكثر من 60 يوم)
    cutoff_date = (datetime.now() - timedelta(days=60)).strftime("%Y-%m-%d")
    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE prediction_date < ?
        AND target_reached = 0 AND stop_hit = 0
        AND prediction_date IS NOT NULL
    """, (cutoff_date,))
    old_pending = cursor.fetchone()[0]
    print(f"   توقعات قديمة بدون نتيجة (قبل {cutoff_date}): {old_pending:,}")

    # ج. توقعات بثقة منخفضة جداً بدون نتيجة
    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE (confidence < 40 OR confidence IS NULL)
        AND target_reached = 0 AND stop_hit = 0
    """)
    low_confidence = cursor.fetchone()[0]
    print(f"   توقعات ثقة منخفضة بدون نتيجة: {low_confidence:,}")

    # د. توقعات بدون ticker أو تاريخ
    cursor.execute("""
        SELECT COUNT(*) FROM prediction_logs
        WHERE ticker IS NULL OR ticker = '' OR prediction_date IS NULL
    """)
    invalid = cursor.fetchone()[0]
    print(f"   توقعات بيانات ناقصة: {invalid:,}")

    total_to_delete = duplicates + old_pending + low_confidence + invalid
    print(f"\n   إجمالى للحذف: {total_to_delete:,}")
    print(f"   سنبقى: {before - total_to_delete:,} توقع")

    if dry_run:
        print("\n⚠ وضع العرض فقط - لن يتم الحذف")
        return before, 0

    # 3. تنفيذ الحذف
    print("\n🧹 تنفيذ الحذف...")

    # حذف المكررة
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE rowid NOT IN (
            SELECT MAX(rowid) FROM prediction_logs
            GROUP BY ticker, prediction_date, recommendation
        )
    """)
    deleted_dups = cursor.rowcount
    print(f"   ✓ تم حذف {deleted_dups:,} تكرار")

    # حذف القديمة بدون نتيجة
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE prediction_date < ?
        AND target_reached = 0 AND stop_hit = 0
    """, (cutoff_date,))
    deleted_old = cursor.rowcount
    print(f"   ✓ تم حذف {deleted_old:,} توقع قديم")

    # حذف ثقة منخفضة
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE (confidence < 40 OR confidence IS NULL)
        AND target_reached = 0 AND stop_hit = 0
    """)
    deleted_low = cursor.rowcount
    print(f"   ✓ تم حذف {deleted_low:,} توقع ثقة منخفضة")

    # حذف بيانات ناقصة
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE ticker IS NULL OR ticker = '' OR prediction_date IS NULL
    """)
    deleted_invalid = cursor.rowcount
    print(f"   ✓ تم حذف {deleted_invalid:,} توقع ناقص")

    conn.commit()

    # 4. عدد التوقعات بعد الفلترة
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    after = cursor.fetchone()[0]
    print(f"\nالتوقعات بعد الفلترة: {after:,}")

    return before, after


def main():
    parser = argparse.ArgumentParser(description="فلترة ذكية للتوقعات")
    parser.add_argument("--dry-run", action="store_true", help="عرض فقط")
    parser.add_argument("--execute", action="store_true", help="تنفيذ فعلى")
    parser.add_argument("--db", type=str, help="مسار قاعدة البيانات")
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        print("\n⚠ وضع العرض فقط")
    else:
        print("\n⚠⚠⚠ وضع التنفيذ الفعلى ⚠⚠⚠")

    # البحث عن قاعدة البيانات
    db_path = Path(args.db) if args.db else find_database()

    if not db_path or not db_path.exists():
        print(f"\n❌ لم يتم العثور على قاعدة البيانات")
        sys.exit(1)

    print(f"\n📂 قاعدة البيانات: {db_path}")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    try:
        # تحليل
        analyze_predictions(conn)

        # فلترة
        before, after = smart_filter(conn, dry_run)

        # ملخص
        print("\n" + "="*70)
        print("📋 ملخص")
        print("="*70)
        if dry_run:
            print(f"سيتم تقليل التوقعات من {before:,} إلى قيمة أقل")
            print("\nللتنفيذ:")
            print(f"    python {__file__} --execute")
        else:
            print(f"✓ قبل: {before:,}")
            print(f"✓ بعد: {after:,}")
            print(f"✓ تم حذف: {before - after:,}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
