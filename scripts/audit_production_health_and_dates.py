#!/usr/bin/env python3
"""
=============================================================================
🔍 AUDIT PRODUCTION HEALTH & DATES — كشف الحساب الشامل لبيانات السيرفر
=============================================================================
هذا السكريبت بيفحص كل قواعد البيانات التشغيلية على السيرفر ويطلعلك:
- اسم كل جدول وعدد صفوفه
- أول تاريخ وأحدث تاريخ مسجل (Min Date -> Max Date)
- هل البيانات طازة (النهاردة وأمس) ولا ميتة ومجمدة من زمان؟
=============================================================================
"""

import sqlite3
import os
import glob
from pathlib import Path
from datetime import datetime

# المسار الافتراضي لقواعد البيانات
PROJECT_ROOT = Path(__file__).resolve().parent.parent if "scripts" in str(Path(__file__)) else Path(__file__).resolve().parent
DB_DIR = PROJECT_ROOT / "db"

# لو مش شغال في مجلد المشروع، دور في المسار المباشر
if not DB_DIR.exists():
    for candidate in [Path("/home/meme/my_apps/GLMinvestment/db"), Path("/root/GLMinvestment/db"), Path("./db")]:
        if candidate.exists():
            DB_DIR = candidate
            break

TARGET_DBS = [
    "stocks.db",
    "price_history.db",
    "intraday.db",
    "predictions.db",
    "data_engine.db",
    "news.db"
]

DATE_COLUMNS = [
    'date', 'datetime', 'price_time', 'timestamp', 
    'last_update', 'updated_at', 'created_at', 
    'prediction_date', 'fiscal_end', 'trade_date'
]

def scan_database(db_file):
    db_path = DB_DIR / db_file
    if not db_path.exists():
        print(f"\n❌ [{db_file}] غير موجود في المسار: {db_path}")
        return

    size_mb = os.path.getsize(db_path) / (1024 * 1024)
    print("\n" + "=" * 80)
    print(f"📦 قاعدة البيانات: {db_file:<20} | الحجم: {size_mb:8.2f} MB | المسار: {db_path}")
    print("=" * 80)

    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(db_path), writable=False).__enter__()
        c = conn.cursor()
        c.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        tables = [r[0] for r in c.fetchall() if not r[0].startswith('sqlite_')]

        print(f"{'الجدول (Table)':<28} | {'عدد الصفوف':<12} | {'أقدم تاريخ':<16} | {'أحدث تاريخ':<22} | {'الحالة'}")
        print("-" * 95)

        for t in tables:
            try:
                c.execute(f"SELECT count(*) FROM {t}")
                cnt = c.fetchone()[0]

                if cnt == 0:
                    print(f"{t:<28} | {0:<12} | {'---':<16} | {'---':<22} | ⚪ فاضي تماماً")
                    continue

                # دور على أعمدة التواريخ
                c.execute(f"PRAGMA table_info({t})")
                cols = [col[1] for col in c.fetchall()]
                matched_dcols = [col for col in cols if any(k == col.lower() or k in col.lower() for k in DATE_COLUMNS)]

                min_val = "غير محدد"
                max_val = "غير محدد"
                status = "⚪ بدون تاريخ"

                if matched_dcols:
                    best_col = matched_dcols[0]
                    # هات أول وآخر تاريخ
                    c.execute(f"SELECT MIN({best_col}), MAX({best_col}) FROM {t} WHERE {best_col} IS NOT NULL AND {best_col} != ''")
                    row = c.fetchone()
                    if row and row[0] is not None:
                        min_val = str(row[0])[:16]
                        max_val = str(row[1])[:19]

                        # تقييم الطزاجة
                        if "2026-10-2" in max_val or "2026-10-1" in max_val:
                            status = "🟢 طازة (أكتوبر 2026)"
                        elif "2026-09" in max_val:
                            status = "🟡 سبتمبر 2026 (متأخر شهر)"
                        elif "2026-08" in max_val or "2026-07" in max_val:
                            status = "🟠 صيف 2026 (متأخر شهرين)"
                        else:
                            status = "🔴 قديم جداً / مجمد"

                print(f"{t:<28} | {cnt:<12,} | {min_val:<16} | {max_val:<22} | {status}")

            except Exception as e:
                print(f"{t:<28} | خطأ في القراءة: {e}")

        conn.close()

    except Exception as e:
        print(f"❌ تعذر فتح {db_file}: {e}")

def main():
    print("=" * 80)
    print("🚀 بدء الفحص الجنائي لتواريخ وطزاجة بيانات السيرفر الإنتاجي")
    print(f"⏰ وقت الفحص: {datetime.now().strftime('%Y-%m-%d %H:%M:%S')}")
    print(f"📁 مجلد القواعد: {DB_DIR}")
    print("=" * 80)

    for db in TARGET_DBS:
        scan_database(db)

    print("\n" + "=" * 80)
    print("🏁 انتهى كشف الحساب.")
    print("=" * 80)

if __name__ == "__main__":
    main()
