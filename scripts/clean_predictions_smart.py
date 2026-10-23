#!/usr/bin/env python3
"""
تنظيف توقعات الذكاء الاصطناعي الذكي
=====================================

المطلوب:
1. 5 توقعات كحد أقصى لكل يوم (الأعلى ثقة)
2. إزالة التكرار (نفس السهم في نفس اليوم)
3. إزالة التكرار (نفس السهم في نفس الأسبوع) ← جديد!
4. إزالة توقعات الإجازات (الجمعة والسبت)

الاستخدام:
    python scripts/clean_predictions_smart.py --dry-run
    python scripts/clean_predictions_smart.py --execute
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

MAX_PREDICTIONS_PER_DAY = 5
WEEKEND_DAYS = [4, 5]  # الجمعة=4, السبت=5 (Python weekday)


def find_database():
    """البحث عن قاعدة البيانات."""
    for db_path in POSSIBLE_DB_PATHS:
        if db_path.exists():
            return db_path
    return None


def is_weekend(date_str):
    """التحقق إذا كان التاريخ في إجازة."""
    try:
        if not date_str:
            return False
        if isinstance(date_str, str):
            dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        else:
            dt = date_str
        return dt.weekday() in WEEKEND_DAYS
    except:
        return False


def get_year_week(date_str):
    """الحصول على سنة-أسبوع من التاريخ."""
    try:
        if not date_str:
            return None
        dt = datetime.strptime(date_str[:10], "%Y-%m-%d")
        return dt.strftime("%Y-W%W")
    except:
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
        print("   لا توجد توقعات!")
        return None

    # 1. توزيع حسب التاريخ (عدد الأيام)
    cursor.execute("""
        SELECT prediction_date, COUNT(*) as cnt
        FROM prediction_logs
        WHERE prediction_date IS NOT NULL
        GROUP BY prediction_date
        ORDER BY prediction_date DESC
    """)
    daily_counts = cursor.fetchall()

    print(f"\n📅 عدد الأيام التي فيها توقعات: {len(daily_counts)}")

    # 2. أيام فيها أكثر من 5 توقعات
    over_limit_days = [(d, c) for d, c in daily_counts if c > MAX_PREDICTIONS_PER_DAY]
    print(f"   أيام فيها أكثر من {MAX_PREDICTIONS_PER_DAY} توقعات: {len(over_limit_days)}")
    if over_limit_days[:3]:
        for d, c in over_limit_days[:3]:
            print(f"      {d}: {c} توقعات")

    # 3. التوقعات المكررة (نفس السهم في نفس اليوم)
    cursor.execute("""
        SELECT ticker, prediction_date, COUNT(*) as cnt
        FROM prediction_logs
        WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
        GROUP BY ticker, prediction_date
        HAVING cnt > 1
        ORDER BY cnt DESC
    """)
    daily_duplicates = cursor.fetchall()
    
    daily_dup_count = sum(c - 1 for _, _, c in daily_duplicates)
    print(f"\n🔄 التكرار في نفس اليوم:")
    print(f"   عدد الأسهم المكررة: {len(daily_duplicates):,}")
    print(f"   عدد التكرارات للحذف: {daily_dup_count:,}")

    # 4. التوقعات المكررة (نفس السهم في نفس الأسبوع)
    cursor.execute("""
        SELECT ticker, 
               substr(prediction_date, 1, 7) || '-W' || strftime('%W', prediction_date) as year_week,
               COUNT(*) as cnt
        FROM prediction_logs
        WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
        GROUP BY ticker, year_week
        HAVING cnt > 1
        ORDER BY cnt DESC
    """)
    weekly_duplicates = cursor.fetchall()
    
    weekly_dup_count = sum(c - 1 for _, _, c in weekly_duplicates)
    print(f"\n🔄 التكرار في نفس الأسبوع:")
    print(f"   عدد الأسهم المكررة: {len(weekly_duplicates):,}")
    print(f"   عدد التكرارات للحذف: {weekly_dup_count:,}")
    if weekly_duplicates[:3]:
        for t, w, c in weekly_duplicates[:3]:
            print(f"      {t} - {w}: {c} مرات")

    # 5. توقعات الإجازات
    weekend_predictions = 0
    weekend_dates = []
    for date_str, cnt in daily_counts:
        if is_weekend(date_str):
            weekend_predictions += cnt
            weekend_dates.append((date_str, cnt))

    print(f"\n🏖️ توقعات في الإجازات: {weekend_predictions} توقع")
    print(f"   عدد أيام الإجازات: {len(weekend_dates)}")

    # حساب التوقعات للحذف
    to_delete_overlimit = sum(c - MAX_PREDICTIONS_PER_DAY for d, c in daily_counts if c > MAX_PREDICTIONS_PER_DAY)

    print(f"\n📊 ملخص التوقعات للحذف:")
    print(f"   تكرار نفس اليوم: {daily_dup_count:,}")
    print(f"   تكرار نفس الأسبوع: {weekly_dup_count:,}")
    print(f"   زيادة عن {MAX_PREDICTIONS_PER_DAY}: {to_delete_overlimit:,}")
    print(f"   توقعات الإجازات: {weekend_predictions:,}")
    print(f"   ─────────────────────")
    
    # التقدير الإجمالي (مع مراعاة التداخل)
    # أولاً هنحذف التكرارات، ثم التكرار الأسبوعي، ثم الزيادة
    estimated_delete = daily_dup_count + weekly_dup_count + to_delete_overlimit + weekend_predictions
    print(f"   تقدير إجمالى للحذف: ~{estimated_delete:,}")
    print(f"   سنبقى: ~{total - estimated_delete:,} توقع")

    return {
        'total': total,
        'daily_duplicates': daily_dup_count,
        'weekly_duplicates': weekly_dup_count,
        'overlimit': to_delete_overlimit,
        'weekend': weekend_predictions,
        'estimated_delete': estimated_delete,
    }


def clean_predictions(conn, dry_run=True):
    """تنظيف التوقعات."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("🧹 تنظيف التوقعات")
    print("="*70)

    # عدد قبل التنظيف
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    before = cursor.fetchone()[0]
    print(f"\nالتوقعات قبل التنظيف: {before:,}")

    if before == 0:
        print("   لا توجد توقعات!")
        return before, before

    if dry_run:
        print("\n⚠ وضع العرض فقط - لن يتم الحذف")
        return before, before

    total_deleted = 0

    # === الخطوة 1: حذف توقعات الإجازات ===
    print("\n🗑️ حذف توقعات الإجازات...")
    
    cursor.execute("""
        SELECT DISTINCT prediction_date FROM prediction_logs
        WHERE prediction_date IS NOT NULL
    """)
    all_dates = [r[0] for r in cursor.fetchall()]

    weekend_dates = [d for d in all_dates if is_weekend(d)]

    if weekend_dates:
        placeholders = ','.join(['?' for _ in weekend_dates])
        cursor.execute(f"""
            DELETE FROM prediction_logs
            WHERE prediction_date IN ({placeholders})
        """, weekend_dates)
        deleted_weekend = cursor.rowcount
        conn.commit()
        total_deleted += deleted_weekend
        print(f"   ✓ تم حذف {deleted_weekend:,} توقع إجازة")
    else:
        print("   لا توجد توقعات في الإجازات")
        deleted_weekend = 0

    # === الخطوة 2: حذف التكرارات (نفس السهم في نفس اليوم) ===
    print("\n🗑️ حذف التكرارات (نفس اليوم)...")
    
    # نحتفظ بالتوقع اللي عنده أعلى ثقة
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE rowid NOT IN (
            SELECT MAX(rowid)
            FROM prediction_logs
            WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
            GROUP BY ticker, prediction_date
        )
        AND prediction_date IS NOT NULL
        AND ticker IS NOT NULL
    """)
    deleted_daily_dups = cursor.rowcount
    conn.commit()
    total_deleted += deleted_daily_dups
    print(f"   ✓ تم حذف {deleted_daily_dups:,} تكرار يومي")

    # === الخطوة 3: حذف التكرارات (نفس السهم في نفس الأسبوع) ===
    print("\n🗑️ حذف التكرارات (نفس الأسبوع)...")
    
    # أولاً نحدد التوقعات المكررة أسبوعياً
    # نحتفظ بأعلى ثقة لكل (ticker, year-week)
    cursor.execute("""
        DELETE FROM prediction_logs
        WHERE rowid NOT IN (
            SELECT MAX(rowid)
            FROM prediction_logs
            WHERE prediction_date IS NOT NULL AND ticker IS NOT NULL
            GROUP BY ticker, substr(prediction_date, 1, 7) || '-W' || strftime('%W', prediction_date)
        )
        AND prediction_date IS NOT NULL
        AND ticker IS NOT NULL
    """)
    deleted_weekly_dups = cursor.rowcount
    conn.commit()
    total_deleted += deleted_weekly_dups
    print(f"   ✓ تم حذف {deleted_weekly_dups:,} تكرار أسبوعي")

    # === الخطوة 4: تقليل لـ 5 توقعات لكل يوم ===
    print(f"\n🗑️ تقليل لـ {MAX_PREDICTIONS_PER_DAY} توقعات لكل يوم...")
    
    cursor.execute("""
        SELECT prediction_date, COUNT(*) as cnt
        FROM prediction_logs
        WHERE prediction_date IS NOT NULL
        GROUP BY prediction_date
        HAVING cnt > ?
    """, (MAX_PREDICTIONS_PER_DAY,))
    over_limit_days = cursor.fetchall()

    deleted_overlimit = 0
    for date_str, cnt in over_limit_days:
        cursor.execute("""
            DELETE FROM prediction_logs
            WHERE prediction_date = ?
            AND rowid NOT IN (
                SELECT rowid FROM prediction_logs
                WHERE prediction_date = ?
                ORDER BY confidence DESC
                LIMIT ?
            )
        """, (date_str, date_str, MAX_PREDICTIONS_PER_DAY))
        deleted_overlimit += cursor.rowcount
        conn.commit()

    total_deleted += deleted_overlimit
    print(f"   ✓ تم حذف {deleted_overlimit:,} توقع زيادة")

    # عدد بعد التنظيف
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    after = cursor.fetchone()[0]

    print(f"\n📊 النتيجة:")
    print(f"   قبل: {before:,}")
    print(f"   بعد: {after:,}")
    print(f"   تم حذف: {total_deleted:,}")

    return before, after


def main():
    parser = argparse.ArgumentParser(description="تنظيف توقعات الذكاء الاصطناعي")
    parser.add_argument("--dry-run", action="store_true", help="عرض فقط")
    parser.add_argument("--execute", action="store_true", help="تنفيذ فعلى")
    parser.add_argument("--db", type=str, help="مسار قاعدة البيانات")
    parser.add_argument("--max-per-day", type=int, default=5, help="الحد الأقصى لكل يوم")
    parser.add_argument("--skip-weekly-dup", action="store_true", help="تخطي حذف التكرار الأسبوعي")
    args = parser.parse_args()

    global MAX_PREDICTIONS_PER_DAY
    MAX_PREDICTIONS_PER_DAY = args.max_per_day

    dry_run = not args.execute

    if dry_run:
        print("\n⚠️ وضع العرض فقط - لن يتم أى تغيير")
    else:
        print("\n⚠️⚠️ وضع التنفيذ الفعلى ⚠️⚠️")

    # البحث عن قاعدة البيانات
    db_path = Path(args.db) if args.db else find_database()

    if not db_path or not db_path.exists():
        print(f"\n❌ لم يتم العثور على قاعدة البيانات")
        print(f"   المسارات المحتملة:")
        for path in POSSIBLE_DB_PATHS:
            exists = "✓" if path.exists() else "✗"
            print(f"   {exists} {path}")
        sys.exit(1)

    print(f"\n📂 قاعدة البيانات: {db_path}")
    print(f"   الحجم: {db_path.stat().st_size / 1024 / 1024:.2f} MB")

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row

    try:
        # تحليل
        stats = analyze_predictions(conn)

        if stats and stats['total'] > 0:
            # تنظيف
            before, after = clean_predictions(conn, dry_run)

            # ملخص
            print("\n" + "="*70)
            print("📋 ملخص")
            print("="*70)
            if dry_run:
                print(f"التوقعات الحالية: {before:,}")
                print(f"تقدير للحذف: ~{stats['estimated_delete']:,}")
                print(f"سنبقى: ~{before - stats['estimated_delete']:,} توقع")
                print("\n✅ للتنفيذ الفعلى:")
                print(f"    python {__file__} --execute")
            else:
                print(f"✅ قبل: {before:,}")
                print(f"✅ بعد: {after:,}")
                print(f"✅ تم حذف: {before - after:,}")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
