#!/usr/bin/env python3
"""
تنظيف سجلات التوقعات - Clean Prediction Logs
===============================================

المشكلة: 538,396 توقع فى 5 شهور = غير منطقى
السبب: التعلم التكرارى كان بيولد توقعات أوتوماتيكى بكميات كبيرة

الحل:
1. نحتفظ بتوقعات الخبراء فقط (ExpertRecommendation)
2. نمسح التوقعات التكرارية الفاسدة (prediction_logs)
3. نعيد بناء التوقعات من التحليلات الحقيقية

Usage:
    python scripts/clean_prediction_logs.py --dry-run  # عرض فقط
    python scripts/clean_prediction_logs.py --execute  # تنفيذ فعلى
"""

import os
import sys
import sqlite3
import argparse
from datetime import datetime, timedelta
from pathlib import Path

# إعداد مسار قاعدة البيانات
SCRIPT_DIR = Path(__file__).parent
PROJECT_ROOT = SCRIPT_DIR.parent
DB_PATH = PROJECT_ROOT / "db" / "stocks.db"


def get_db_connection():
    """إنشاء اتصال بقاعدة البيانات."""
    conn = sqlite3.connect(str(DB_PATH))
    conn.row_factory = sqlite3.Row
    return conn


def analyze_prediction_logs(conn):
    """تحليل سجلات التوقعات."""
    cursor = conn.cursor()

    print("\n" + "="*60)
    print("تحليل سجلات التوقعات (prediction_logs)")
    print("="*60)

    # إجمالى التوقعات
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    total = cursor.fetchone()[0]
    print(f"\nإجمالى التوقعات: {total:,}")

    if total == 0:
        print("لا توجد توقعات للتحليل")
        return

    # توزيع حسب التوصية
    print("\nتوزيع حسب التوصية:")
    cursor.execute("""
        SELECT recommendation, COUNT(*) as cnt
        FROM prediction_logs
        GROUP BY recommendation
        ORDER BY cnt DESC
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,}")

    # توزيع حسب الشهر
    print("\nتوزيع حسب الشهر:")
    cursor.execute("""
        SELECT substr(prediction_date, 1, 7) as month, COUNT(*) as cnt
        FROM prediction_logs
        GROUP BY month
        ORDER BY month DESC
        LIMIT 12
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,}")

    # توزيع حسب السهم (أعلى 10)
    print("\nأعلى 10 أسهم فى التوقعات:")
    cursor.execute("""
        SELECT ticker, COUNT(*) as cnt
        FROM prediction_logs
        GROUP BY ticker
        ORDER BY cnt DESC
        LIMIT 10
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,}")

    # توقعات مغلقة vs مفتوحة
    cursor.execute("""
        SELECT
            COUNT(*) as total,
            SUM(CASE WHEN target_reached = 1 THEN 1 ELSE 0 END) as target_reached,
            SUM(CASE WHEN stop_hit = 1 THEN 1 ELSE 0 END) as stop_hit,
            SUM(CASE WHEN target_reached = 0 AND stop_hit = 0 THEN 1 ELSE 0 END) as pending
        FROM prediction_logs
    """)
    row = cursor.fetchone()
    print(f"\nحالة التوقعات:")
    print(f"  حققت الهدف: {row[1]:,}")
    print(f"  وقف خسارة: {row[2]:,}")
    print(f"  معلقة: {row[3]:,}")


def analyze_expert_recommendations(conn):
    """تحليل توصيات الخبراء."""
    cursor = conn.cursor()

    print("\n" + "="*60)
    print("تحليل توصيات الخبراء (ExpertRecommendation)")
    print("="*60)

    # إجمالى التوصيات
    cursor.execute("SELECT COUNT(*) FROM ExpertRecommendation")
    total = cursor.fetchone()[0]
    print(f"\nإجمالى توصيات الخبراء: {total:,}")

    if total == 0:
        print("لا توجد توصيات خبراء")
        return

    # توزيع حسب الخبير
    print("\nتوزيع حسب الخبير:")
    cursor.execute("""
        SELECT expert_name, COUNT(*) as cnt
        FROM ExpertRecommendation
        GROUP BY expert_name
        ORDER BY cnt DESC
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,}")

    # توزيع حسب الحالة
    print("\nتوزيع حسب الحالة:")
    cursor.execute("""
        SELECT status, COUNT(*) as cnt
        FROM ExpertRecommendation
        GROUP BY status
        ORDER BY cnt DESC
    """)
    for row in cursor.fetchall():
        print(f"  {row[0]}: {row[1]:,}")


def clean_prediction_logs(conn, dry_run=True):
    """تنظيف سجلات التوقعات."""
    cursor = conn.cursor()

    print("\n" + "="*60)
    print("تنظيف سجلات التوقعات")
    print("="*60)

    # 1. حذف كل التوقعات القديمة (التعلم التكرارى)
    cursor.execute("SELECT COUNT(*) FROM prediction_logs")
    total = cursor.fetchone()[0]

    if total == 0:
        print("لا توجد توقعات للحذف")
        return 0

    print(f"\nسيتم حذف {total:,} توقع من prediction_logs")

    if not dry_run:
        cursor.execute("DELETE FROM prediction_logs")
        conn.commit()
        print(f"✓ تم حذف {total:,} توقع")

        # إعادة تعيين الـ auto-increment
        cursor.execute("DELETE FROM sqlite_sequence WHERE name='prediction_logs'")
        conn.commit()
        print("✓ تم إعادة تعيين العداد")
    else:
        print("⚠ وضع العرض فقط - لن يتم الحذف")

    return total


def rebuild_from_experts(conn, dry_run=True):
    """إعادة بناء التوقعات من توصيات الخبراء."""
    cursor = conn.cursor()

    print("\n" + "="*60)
    print("إعادة بناء التوقعات من توصيات الخبراء")
    print("="*60)

    # التحقق من وجود توصيات خبراء
    cursor.execute("SELECT COUNT(*) FROM ExpertRecommendation")
    expert_count = cursor.fetchone()[0]

    if expert_count == 0:
        print("لا توجد توصيات خبراء لإعادة البناء منها")
        return

    print(f"\nتوجد {expert_count:,} توصية خبراء")

    # قراءة توصيات الخبراء
    cursor.execute("""
        SELECT
            id, stock_symbol, recommendation_date, action,
            entry_price, target_price, stop_loss,
            status, hit_target, hit_stop_loss
        FROM ExpertRecommendation
        WHERE recommendation_date IS NOT NULL
        ORDER BY recommendation_date DESC
    """)
    expert_recs = cursor.fetchall()

    print(f"تم قراءة {len(expert_recs):,} توصية")

    # تحويل توصيات الخبراء لتوقعات
    predictions = []
    for rec in expert_recs:
        # تحويل action لتوصية
        if rec['action'] in ['BUY', 'BUY_AND_HOLD', 'AVERAGE_DOWN']:
            recommendation = 'ACCUMULATE'
        elif rec['action'] == 'SELL':
            recommendation = 'REDUCE'
        else:
            recommendation = 'HOLD'

        # تحويل الحالة
        target_reached = 1 if rec['hit_target'] or rec['status'] == 'TARGET_HIT' else 0
        stop_hit = 1 if rec['hit_stop_loss'] or rec['status'] == 'STOPPED' else 0

        predictions.append({
            'id': rec['id'],
            'ticker': rec['stock_symbol'],
            'prediction_date': rec['recommendation_date'],
            'recommendation': recommendation,
            'confidence': 70,  # ثقة افتراضية للخبراء
            'entry_price': rec['entry_price'],
            'target_price': rec['target_price'],
            'stop_loss': rec['stop_loss'],
            'target_reached': target_reached,
            'stop_hit': stop_hit,
        })

    if not dry_run and predictions:
        # إدخال التوقعات الجديدة
        for pred in predictions:
            cursor.execute("""
                INSERT INTO prediction_logs
                (id, ticker, prediction_date, recommendation, confidence,
                 entry_price, target_price, stop_loss, target_reached, stop_hit)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            """, (
                pred['id'], pred['ticker'], pred['prediction_date'],
                pred['recommendation'], pred['confidence'],
                pred['entry_price'], pred['target_price'], pred['stop_loss'],
                pred['target_reached'], pred['stop_hit']
            ))
        conn.commit()
        print(f"✓ تم إدخال {len(predictions):,} توقع من الخبراء")
    else:
        print(f"⚠ وضع العرض فقط - سيتم إدخال {len(predictions):,} توقع")

    return len(predictions)


def main():
    parser = argparse.ArgumentParser(description="تنظيف سجلات التوقعات")
    parser.add_argument("--dry-run", action="store_true", help="عرض فقط بدون تنفيذ")
    parser.add_argument("--execute", action="store_true", help="تنفيذ فعلى")
    args = parser.parse_args()

    dry_run = not args.execute

    if dry_run:
        print("⚠ وضع العرض فقط - لن يتم أى تغيير")
    else:
        print("⚠⚠⚠ وضع التنفيذ الفعلى ⚠⚠⚠")

    # التحقق من وجود قاعدة البيانات
    if not DB_PATH.exists():
        print(f"خطأ: قاعدة البيانات غير موجودة: {DB_PATH}")
        sys.exit(1)

    print(f"قاعدة البيانات: {DB_PATH}")

    # الاتصال بقاعدة البيانات
    conn = get_db_connection()

    try:
        # تحليل البيانات الحالية
        analyze_prediction_logs(conn)
        analyze_expert_recommendations(conn)

        # تنظيف التوقعات
        deleted = clean_prediction_logs(conn, dry_run)

        # إعادة البناء من الخبراء
        inserted = rebuild_from_experts(conn, dry_run)

        # ملخص
        print("\n" + "="*60)
        print("الملخص")
        print("="*60)
        print(f"تم حذف: {deleted:,} توقع")
        print(f"تم إدخال: {inserted:,} توقع من الخبراء")

        if dry_run:
            print("\n⚠ هذا كان وضع العرض فقط")
            print("للتنفيذ الفعلى، استخدم: python scripts/clean_prediction_logs.py --execute")

    finally:
        conn.close()


if __name__ == "__main__":
    main()
