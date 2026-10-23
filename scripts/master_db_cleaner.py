#!/usr/bin/env python3
"""
scripts/master_db_cleaner.py — سكريبت التطهير الشامل لقواعد البيانات
===================================================================
1. الحفاظ الصارم على قواعد البيانات الحية المعتمدة فقط:
   - stocks.db, price_history.db, data_engine.db, intraday.db, predictions.db, news.db, auth.db
2. إعدام وحذف جميع الجداول الميتة (0 صفوف) في القواعد الحية وعمل VACUUM لتقليص الحجم واستعادة المساحة.
3. نقل جميع مخلفات التجارب والنسخ الاحتياطية القديمة والملفات التالفة (أكثر من 11 جيجا) إلى:
   db/archive_storage/
4. يترك مجلد db/ نظيفاً ومرتباً تماماً.
"""

import os
import sys
import shutil
import sqlite3
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / "db"
ARCHIVE_DIR = DB_DIR / "archive_storage"

# القواعد التشغيلية الحية فقط (ممنوع لمسها أو نقلها)
CANONICAL_DBS = {
    "stocks.db",
    "price_history.db",
    "data_engine.db",
    "intraday.db",
    "predictions.db",
    "news.db",
    "auth.db",
    "metrics.db",
}

# لواحق وملفات مؤقتة خاصة بقواعد البيانات الحية تظل معها
CANONICAL_EXTENSIONS = {
    "-wal",
    "-shm",
}


def log(msg: str):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] {msg}")


def clean_empty_tables(db_path: Path):
    """فحص قاعدة البيانات وحذف الجداول الفارغة (0 صف) وعمل VACUUM."""
    if not db_path.exists():
        return 0, 0
    
    size_before = db_path.stat().st_size
    dropped = []
    kept = []
    
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.connection(str(db_path), writable=False).__enter__()
        cursor = conn.cursor()
        
        tables = [
            row[0]
            for row in cursor.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
            ).fetchall()
        ]
        
        for t in tables:
            try:
                cnt = cursor.execute(f"SELECT count(*) FROM `{t}`").fetchone()[0]
                if cnt == 0:
                    cursor.execute(f"DROP TABLE `{t}`")
                    dropped.append(t)
                else:
                    kept.append((t, cnt))
            except Exception as e:
                pass
                
        conn.commit()
        
        if dropped:
            cursor.execute("VACUUM")
        conn.close()
        
        size_after = db_path.stat().st_size
        freed_mb = (size_before - size_after) / (1024 * 1024)
        
        log(f"  📊 {db_path.name:18} | حُذف {len(dropped):2d} جدول ميت | احتُفظ بـ {len(kept):2d} جدول نشط | توفير: {freed_mb:5.1f} MB")
        return len(dropped), freed_mb
    except Exception as e:
        log(f"  ⚠️ خطأ أثناء فحص {db_path.name}: {e}")
        return 0, 0


def run_master_cleanup():
    log("==================================================================")
    log("🧹 بدء عملية التطهير الشامل لقواعد البيانات (Master DB Cleaner)")
    log("==================================================================")
    
    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    
    # المرحلة 1: تنظيف الجداول الفارغة في القواعد الحية
    log("\n[المرحلة 1] فحص وتنظيف الجداول الميتة في القواعد الحية وعمل VACUUM...")
    total_dropped = 0
    total_freed_vacuum = 0.0
    
    for db_name in sorted(CANONICAL_DBS):
        db_path = DB_DIR / db_name
        if db_path.exists():
            d_cnt, freed = clean_empty_tables(db_path)
            total_dropped += d_cnt
            total_freed_vacuum += freed

    # المرحلة 2: كنس الملفات الميتة والنسخ القديمة إلى archive_storage
    log("\n[المرحلة 2] كنس الملفات الزائدة والمضروبة والنسخ القديمة إلى archive_storage...")
    
    moved_count = 0
    moved_bytes = 0
    
    for item in list(DB_DIR.iterdir()):
        # لا نلمس مجلد الأرشيف نفسه أو المجلدات الفرعية المعزولة مسبقاً
        if item.is_dir():
            if item.name not in ("archive_storage", "backups", "retired_zombie_dbs", "screener_cards"):
                dest = ARCHIVE_DIR / item.name
                if not dest.exists():
                    shutil.move(str(item), str(dest))
                    log(f"  🚚 نقل مجلد قديم: {item.name}/ -> archive_storage/")
            continue
            
        fname = item.name
        
        # تحقق هل الملف ينتمي للقواعد الحية؟
        is_canonical = False
        if fname in CANONICAL_DBS:
            is_canonical = True
        else:
            for c_db in CANONICAL_DBS:
                if fname.startswith(c_db) and any(fname.endswith(ext) for ext in CANONICAL_EXTENSIONS):
                    is_canonical = True
                    break
        
        if not is_canonical:
            fsize = item.stat().st_size
            dest = ARCHIVE_DIR / fname
            try:
                # إذا كان الملف موجود في الأرشيف سابقاً يتم استبداله
                if dest.exists():
                    if dest.is_dir():
                        shutil.rmtree(str(dest))
                    else:
                        dest.unlink()
                shutil.move(str(item), str(dest))
                moved_count += 1
                moved_bytes += fsize
            except Exception as e:
                log(f"  ⚠️ تعذر نقل {fname}: {e}")

    moved_gb = moved_bytes / (1024 * 1024 * 1024)
    log(f"✅ تم نقل {moved_count} ملف قديم بحجم إجمالي: {moved_gb:.2f} GB إلى archive_storage/")

    # المرحلة 3: جرد مجلد db/ بعد التطهير
    log("\n[المرحلة 3] جرد مجلد db/ بعد التطهير:")
    remaining_files = sorted([f.name for f in DB_DIR.iterdir() if f.is_file()])
    for rf in remaining_files:
        f_size = (DB_DIR / rf).stat().st_size / (1024 * 1024)
        log(f"  📁 {rf:25} | الحجم: {f_size:6.2f} MB")
        
    log("==================================================================")
    log(f"🎉 تمت النظافة بنجاح! تم كنس {moved_gb:.2f} جيجا وحذف {total_dropped} جدول ميت.")
    log(f"📂 مسار الأرشيف في حال احتجت أي ملف قديم: {ARCHIVE_DIR}")
    log("==================================================================")


if __name__ == "__main__":
    run_master_cleanup()
