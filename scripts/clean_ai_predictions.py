#!/usr/bin/env python3
"""
تنظيف توقعات الذكاء الاصطناعي - Clean AI Predictions
========================================================

المشكلة: 538,396 توقع فى 5 شهور = غير منطقى (ده من التعلم التكرارى الفاسد)
الهدف: تنظيف البيانات والإبقاء فقط على التوقعات المنطقية

الاستخدام:
    python scripts/clean_ai_predictions.py --dry-run   # عرض فقط
    python scripts/clean_ai_predictions.py --execute   # تنفيذ فعلى

قاعدة البيانات: db/stocks.db (على نفس مستوى المشروع)
"""

import os
import sys
import sqlite3
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# البحث عن قاعدة البيانات
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent

# مسارات محتملة لقاعدة البيانات
POSSIBLE_DB_PATHS = [
    PROJECT_ROOT / "db" / "stocks.db",
    PROJECT_ROOT / "db" / "stocks.db",
      # VPS path
      # VPS alternative path
    
]

def find_database():
    """البحث عن قاعدة البيانات."""
    for db_path in POSSIBLE_DB_PATHS:
        if db_path.exists():
            return db_path
    
    # البحث فى المسار الحالى
    for db_path in Path.cwd().rglob("stocks.db"):
        return db_path
    
    return None


def get_db_connection(db_path):
    """إنشاء اتصال بقاعدة البيانات."""
    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(db_path), writable=False).__enter__()
    conn.row_factory = sqlite3.Row
    return conn


def analyze_current_data(conn):
    """تحليل البيانات الحالية."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("📊 تحليل البيانات الحالية")
    print("="*70)

    # 1. تحليل prediction_logs
    print("\n🔹 جدول prediction_logs:")
    try:
        cursor.execute("SELECT COUNT(*) FROM prediction_logs")
        total = cursor.fetchone()[0]
        print(f"   إجمالى التوقعات: {total:,}")

        if total > 0:
            # توزيع حسب التوصية
            cursor.execute("""
                SELECT recommendation, COUNT(*) as cnt
                FROM prediction_logs
                GROUP BY recommendation
                ORDER BY cnt DESC
            """)
            print("\n   توزيع حسب التوصية:")
            for row in cursor.fetchall():
                print(f"      {row[0]}: {row[1]:,}")

            # توزيع حسب الشهر
            cursor.execute("""
                SELECT substr(prediction_date, 1, 7) as month, COUNT(*) as cnt
                FROM prediction_logs
                GROUP BY month
                ORDER BY month DESC
                LIMIT 6
            """)
            print("\n   توزيع حسب الشهر:")
            for row in cursor.fetchall():
                print(f"      {row[0]}: {row[1]:,}")

            # معدل التوقعات اليومي
            cursor.execute("""
                SELECT MIN(prediction_date) as min_date, MAX(prediction_date) as max_date
                FROM prediction_logs
                WHERE prediction_date IS NOT NULL
            """)
            date_range = cursor.fetchone()
            if date_range[0] and date_range[1]:
                min_date = datetime.strptime(date_range[0][:10], "%Y-%m-%d")
                max_date = datetime.strptime(date_range[1][:10], "%Y-%m-%d")
                days = (max_date - min_date).days + 1
                daily_avg = total / max(days, 1)
                print(f"\n   متوسط التوقعات اليومي: {daily_avg:.0f} توقع/يوم")
                print(f"   نطاق التواريخ: {date_range[0][:10]} إلى {date_range[1][:10]} ({days} يوم)")
    except Exception as e:
        print(f"   خطأ: {e}")

    # 2. تحليل ExpertRecommendation
    print("\n🔹 جدول ExpertRecommendation:")
    try:
        cursor.execute("SELECT COUNT(*) FROM ExpertRecommendation")
        total = cursor.fetchone()[0]
        print(f"   إجمالى توصيات الخبراء: {total:,}")

        if total > 0:
            cursor.execute("""
                SELECT status, COUNT(*) as cnt
                FROM ExpertRecommendation
                GROUP BY status
                ORDER BY cnt DESC
            """)
            print("\n   توزيع حسب الحالة:")
            for row in cursor.fetchall():
                print(f"      {row[0]}: {row[1]:,}")
    except Exception as e:
        print(f"   خطأ: {e}")

    # 3. تحليل cached_analysis
    print("\n🔹 جدول cached_analysis:")
    try:
        cursor.execute("SELECT COUNT(*) FROM cached_analysis")
        total = cursor.fetchone()[0]
        print(f"   إجمالى التحليلات المختزنة: {total:,}")

        if total > 0:
            cursor.execute("""
                SELECT signal, COUNT(*) as cnt
                FROM cached_analysis
                GROUP BY signal
                ORDER BY cnt DESC
            """)
            print("\n   توزيع حسب الإشارة:")
            for row in cursor.fetchall():
                print(f"      {row[0]}: {row[1]:,}")
    except Exception as e:
        print(f"   خطأ: {e}")

    return True


def clean_prediction_logs(conn, dry_run=True):
    """تنظيف جدول prediction_logs."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("🧹 تنظيف جدول prediction_logs")
    print("="*70)

    # عدد التوقعات قبل التنظيف
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    before_count = cursor.fetchone()[0]

    print(f"\nالتوقعات قبل التنظيف: {before_count:,}")

    if before_count == 0:
        print("✓ الجدول فارغ بالفعل")
        return 0

    # حذف كل التوقعات (التعلم التكرارى كله فاسد)
    if not dry_run:
        cursor.execute("DELETE FROM prediction_logs")
        conn.commit()

        # إعادة تعيين العداد
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='prediction_logs'")
        conn.commit()

        print(f"✓ تم حذف {before_count:,} توقع")
    else:
        print(f"⚠ وضع العرض - سيتم حذف {before_count:,} توقع")

    return before_count


def clean_learned_lessons(conn, dry_run=True):
    """تنظيف جدول learned_lessons."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("🧹 تنظيف جدول learned_lessons")
    print("="*70)

    try:
        cursor.execute("SELECT COUNT(*) FROM learned_lessons")
        before_count = cursor.fetchone()[0]

        print(f"\nالدروس قبل التنظيف: {before_count:,}")

        if before_count == 0:
            print("✓ الجدول فارغ بالفعل")
            return 0

        # الاحتفاظ بالدروس من آخر 30 يوم فقط
        cutoff_date = (datetime.now() - timedelta(days=30)).strftime("%Y-%m-%d")

        if not dry_run:
            cursor.execute(f"DELETE FROM learned_lessons WHERE created_at < ?", (cutoff_date,))
            deleted = cursor.rowcount
            conn.commit()

            print(f"✓ تم حذف {deleted:,} درس قديم")
            print(f"✓ تم الاحتفاظ بالدروس من آخر 30 يوم")
        else:
            cursor.execute(f"SELECT COUNT(*) FROM learned_lessons WHERE created_at < ?", (cutoff_date,))
            to_delete = cursor.fetchone()[0]
            print(f"⚠ وضع العرض - سيتم حذف {to_delete:,} درس قديم")

        return before_count
    except Exception as e:
        print(f"   تخطى: {e}")
        return 0


def rebuild_from_experts(conn, dry_run=True):
    """إعادة بناء التوقعات من توصيات الخبراء."""
    cursor = conn.cursor()

    print("\n" + "="*70)
    print("🔨 إعادة بناء التوقعات من توصيات الخبراء")
    print("="*70)

    # قراءة توصيات الخبراء
    cursor.execute("SELECT COUNT(*) FROM ExpertRecommendation")
    expert_count = cursor.fetchone()[0]

    if expert_count == 0:
        print("لا توجد توصيات خبراء")
        return 0

    print(f"\nتوجد {expert_count:,} توصية خبراء")

    # تحويل توصيات الخبراء لتوقعات
    # استخدام الأعمدة الموجودة فقط
    cursor.execute("""
        SELECT 
            id, stock_symbol, session_date, action,
            entry_price, target_price, stop_loss,
            status
        FROM ExpertRecommendation
        WHERE session_date IS NOT NULL
        ORDER BY session_date DESC
    """)
    expert_recs = cursor.fetchall()

    predictions = []
    for rec in expert_recs:
        # تحويل action لتوصية
        action = rec['action'] or ''
        if action in ['BUY', 'BUY_AND_HOLD', 'AVERAGE_DOWN']:
            recommendation = 'ACCUMULATE'
        elif action == 'SELL':
            recommendation = 'REDUCE'
        else:
            recommendation = 'HOLD'

        # تحويل الحالة من status
        status = rec['status'] or ''
        target_reached = 1 if status in ['TARGET_HIT', 'CLOSE_TO_TARGET'] else 0
        stop_hit = 1 if status == 'STOPPED' else 0

        predictions.append({
            'id': f"expert_{rec['id']}",
            'ticker': rec['stock_symbol'],
            'prediction_date': rec['session_date'],
            'recommendation': recommendation,
            'confidence': 75,  # ثقة افتراضية للخبراء
            'entry_price': rec['entry_price'],
            'target_price': rec['target_price'],
            'stop_loss': rec['stop_loss'],
            'target_reached': target_reached,
            'stop_hit': stop_hit,
            'direction_correct_5d': 1 if target_reached else 0,
        })

    if predictions:
        if not dry_run:
            for pred in predictions:
                cursor.execute("""
                    INSERT OR REPLACE INTO prediction_logs
                    (id, ticker, prediction_date, recommendation, confidence,
                     entry_price, target_price, stop_loss, target_reached, stop_hit,
                     direction_correct_5d)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, (
                    pred['id'], pred['ticker'], pred['prediction_date'],
                    pred['recommendation'], pred['confidence'],
                    pred['entry_price'], pred['target_price'], pred['stop_loss'],
                    pred['target_reached'], pred['stop_hit'], pred['direction_correct_5d']
                ))
            conn.commit()
            print(f"✓ تم إدخال {len(predictions):,} توقع من الخبراء")
        else:
            print(f"⚠ وضع العرض - سيتم إدخال {len(predictions):,} توقع من الخبراء")

    return len(predictions)


def main():
    parser = argparse.ArgumentParser(description="تنظيف توقعات الذكاء الاصطناعي")
    parser.add_argument("--dry-run", action="store_true", help="عرض فقط بدون تنفيذ")
    parser.add_argument("--execute", action="store_true", help="تنفيذ فعلى")
    parser.add_argument("--db", type=str, help="مسار قاعدة البيانات")
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        print("\n⚠ وضع العرض فقط - لن يتم أى تغيير")
    else:
        print("\n⚠⚠⚠ وضع التنفيذ الفعلى ⚠⚠⚠")

    # البحث عن قاعدة البيانات
    if args.db:
        db_path = Path(args.db)
    else:
        db_path = find_database()

    if not db_path or not db_path.exists():
        print(f"\n❌ خطأ: لم يتم العثور على قاعدة البيانات")
        print(f"   المسارات المحتملة:")
        for path in POSSIBLE_DB_PATHS:
            exists = "✓" if path.exists() else "✗"
            print(f"   {exists} {path}")
        sys.exit(1)

    print(f"\n📂 قاعدة البيانات: {db_path}")
    print(f"   الحجم: {db_path.stat().st_size / 1024 / 1024:.2f} MB")

    # الاتصال بقاعدة البيانات
    conn = get_db_connection(db_path)

    try:
        # تحليل البيانات الحالية
        analyze_current_data(conn)

        # تنظيف التوقعات
        deleted = clean_prediction_logs(conn, dry_run)

        # تنظيف الدروس المستفادة
        clean_learned_lessons(conn, dry_run)

        # إعادة البناء من الخبراء
        inserted = rebuild_from_experts(conn, dry_run)

        # ملخص
        print("\n" + "="*70)
        print("📋 ملخص العملية")
        print("="*70)
        print(f"تم حذف: {deleted:,} توقع فاسد")
        print(f"تم إدخال: {inserted:,} توقع من الخبراء")

        if dry_run:
            print("\n⚠ هذا كان وضع العرض فقط")
            print("للتنفيذ الفعلى، استخدم:")
            print(f"    python {__file__} --execute")
        else:
            print("\n✓ تم التنظيف بنجاح!")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
