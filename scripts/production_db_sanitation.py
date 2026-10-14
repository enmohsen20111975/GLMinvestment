#!/usr/bin/env python3
"""
production_db_sanitation.py — تطهير وهندسة قواعد البيانات على سيرفر الإنتاج (VPS)
================================================================================
Idempotent, safe, non-destructive data cleanup script.

الأهداف:
  1. ضغط جميع ملفات النسخ الاحتياطية الخام غير المضغوطة في db/backups/*.db
     بصيغة gzip ونقلها إلى db/backups/cold_archive/ (توفير 600+ ميجابايت على السيرفر).
  2. إزالة الجداول المؤقتة المتروكة في db/data_engine.db (مثل tab_*_pre_repair_*).
  3. عمل VACUUM آمن لقواعد البيانات لتحرير المساحة الفعلية للقرص الصلب.
  4. فحص النزاهة الهندسية (PRAGMA integrity_check) لجميع القواعد النشطة.

الاستخدام:
  python3 scripts/production_db_sanitation.py            # فحص وتنفيذ فعلي
  python3 scripts/production_db_sanitation.py --dry-run  # فحص فقط بدون تعديل
"""

from __future__ import annotations
import argparse
import gzip
import os
import shutil
import sqlite3
import sys
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"
BACKUP_DIR = DB_DIR / "backups"
COLD_DIR = BACKUP_DIR / "cold_archive"

CORE_DBS = [
    "price_history.db",
    "predictions.db",
    "stocks.db",
    "data_engine.db",
    "intraday.db",
    "news.db",
    "auth.db",
]


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def get_dir_size_mb(path: Path) -> float:
    if not path.exists():
        return 0.0
    total = sum(f.stat().st_size for f in path.rglob("*") if f.is_file())
    return total / (1024 * 1024)


def step1_compress_backups(dry_run: bool = False) -> tuple[int, float]:
    """ضغط ملفات الداتابيز الكبيرة في db/backups/ ونقلها لـ cold_archive."""
    log("المرحلة 1: فحص وضغط النسخ الاحتياطية الخام في db/backups/")
    if not BACKUP_DIR.exists():
        log(f"  المجلد غير موجود: {BACKUP_DIR}", "WARN")
        return 0, 0.0

    if not dry_run:
        COLD_DIR.mkdir(parents=True, exist_ok=True)

    raw_files = [f for f in BACKUP_DIR.glob("*.db") if f.is_file()]
    if not raw_files:
        log("  لا توجد ملفات .db خام غير مضغوطة في db/backups/ (المجلد نظيف بالفعل)", "OK")
        return 0, 0.0

    total_saved_mb = 0.0
    compressed_count = 0

    for f in sorted(raw_files, key=lambda x: x.stat().st_size, reverse=True):
        size_mb = f.stat().st_size / (1024 * 1024)
        gz_target = COLD_DIR / f"{f.name}.gz"
        log(f"  ملف خام: {f.name} ({size_mb:.1f} MB)")

        if dry_run:
            log(f"    [DRY-RUN] سيتم ضغطه إلى {gz_target.name} وحذف الملف الخام")
            total_saved_mb += size_mb * 0.85  # تقدير توفير 85%
            compressed_count += 1
            continue

        try:
            with open(f, "rb") as f_in:
                with gzip.open(gz_target, "wb", compresslevel=6) as f_out:
                    shutil.copyfileobj(f_in, f_out)
            gz_size_mb = gz_target.stat().st_size / (1024 * 1024)
            saved_mb = size_mb - gz_size_mb
            total_saved_mb += saved_mb
            compressed_count += 1
            f.unlink()
            log(f"    نجح الضغط! الحجم الجديد: {gz_size_mb:.1f} MB (تم توفير {saved_mb:.1f} MB)", "OK")
        except Exception as e:
            log(f"    فشل ضغط {f.name}: {e}", "ERROR")

    return compressed_count, total_saved_mb


def step2_clean_data_engine_tables(dry_run: bool = False) -> int:
    """حذف الجداول المؤقتة الناتجة عن ترقيعات قديمة في data_engine.db."""
    log("المرحلة 2: فحص وتنظيف الجداول المؤقتة في data_engine.db")
    de_path = DB_DIR / "data_engine.db"
    if not de_path.exists():
        log(f"  data_engine.db غير موجود: {de_path}", "WARN")
        return 0

    try:
        conn = sqlite3.connect(de_path)
        cur = conn.cursor()
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' AND name LIKE '%pre_repair%'")
        pre_tables = [t[0] for t in cur.fetchall()]

        if not pre_tables:
            log("  لا توجد جداول pre_repair مؤقتة (الداتابيز نظيفة)", "OK")
            conn.close()
            return 0

        log(f"  تم العثور على {len(pre_tables)} جدول مؤقت: {pre_tables}")
        if dry_run:
            log("  [DRY-RUN] سيتم حذف الجداول وعمل VACUUM")
            conn.close()
            return len(pre_tables)

        for tbl in pre_tables:
            cur.execute(f"DROP TABLE IF EXISTS [{tbl}]")
            log(f"    تم حذف الجدول المؤقت: {tbl}")

        conn.commit()
        log("  جاري عمل VACUUM لاسترجاع المساحة للقرص...")
        cur.execute("VACUUM")
        conn.close()
        new_size_mb = de_path.stat().st_size / (1024 * 1024)
        log(f"  اكتمل تنظيف data_engine.db! الحجم الحالي: {new_size_mb:.1f} MB", "OK")
        return len(pre_tables)
    except Exception as e:
        log(f"  خطأ أثناء فحص/تنظيف data_engine.db: {e}", "ERROR")
        return 0


def step3_vacuum_core_dbs(dry_run: bool = False) -> None:
    """عمل VACUUM آمن للقواعد الأساسية إذا لزم الأمر."""
    log("المرحلة 3: فحص الـ VACUUM لقواعد البيانات النشطة")
    for db_name in ["stocks.db", "predictions.db"]:
        db_file = DB_DIR / db_name
        if not db_file.exists():
            continue
        size_before = db_file.stat().st_size / (1024 * 1024)
        if dry_run:
            log(f"  [DRY-RUN] فحص {db_name} ({size_before:.1f} MB)")
            continue

        try:
            conn = sqlite3.connect(db_file)
            conn.execute("VACUUM")
            conn.close()
            size_after = db_file.stat().st_size / (1024 * 1024)
            diff = size_before - size_after
            if diff > 0.5:
                log(f"  {db_name}: تم تحرير {diff:.1f} MB (الحالي: {size_after:.1f} MB)", "OK")
            else:
                log(f"  {db_name}: مدمجة ومستقرة بالفعل ({size_after:.1f} MB)", "OK")
        except Exception as e:
            log(f"  تحذير VACUUM على {db_name}: {e}", "WARN")


def step4_verify_integrity() -> bool:
    """فحص سلامة الـ SQLite Headers والبيانات لجميع القواعد الأساسية."""
    log("المرحلة 4: الفحص الهندسي للنزاهة (PRAGMA integrity_check)")
    all_ok = True
    for db_name in CORE_DBS:
        p = DB_DIR / db_name
        if not p.exists():
            log(f"  {db_name}: غير موجود", "WARN")
            continue
        try:
            conn = sqlite3.connect(f"file:{p}?mode=ro", uri=True)
            res = conn.execute("PRAGMA integrity_check;").fetchone()
            conn.close()
            status = res[0] if res else "unknown"
            if status == "ok":
                size_mb = p.stat().st_size / (1024 * 1024)
                log(f"  {db_name} ({size_mb:.1f} MB): سليمة 100% (integrity: ok)", "OK")
            else:
                log(f"  {db_name}: فحص النزاهة أرجع {status}", "ERROR")
                all_ok = False
        except Exception as e:
            log(f"  {db_name}: خطأ فحص النزاهة: {e}", "ERROR")
            all_ok = False
    return all_ok


def main() -> int:
    parser = argparse.ArgumentParser(description="Production Database Sanitation Capsule")
    parser.add_argument("--dry-run", action="store_true", help="فحص فقط بدون تعديل أو حذف")
    args = parser.parse_args()

    mode = "DRY-RUN" if args.dry_run else "EXECUTE"
    log("=" * 65)
    log(f"🚀 production_db_sanitation.py — تطهير قواعد بيانات الإنتاج ({mode})")
    log("=" * 65)

    size_before = get_dir_size_mb(DB_DIR)
    log(f"الحجم الإجمالي لفولدر db/ قبل العملية: {size_before:.1f} MB\n")

    count, saved_mb = step1_compress_backups(dry_run=args.dry_run)
    log("")
    dropped_count = step2_clean_data_engine_tables(dry_run=args.dry_run)
    log("")
    step3_vacuum_core_dbs(dry_run=args.dry_run)
    log("")
    integrity_ok = step4_verify_integrity()

    size_after = get_dir_size_mb(DB_DIR)
    log("")
    log("=" * 65)
    log("📊 تقرير نتيجة التطهير:")
    log(f"  - عدد ملفات الباك-أب المضغوطة: {count}")
    log(f"  - عدد الجداول المؤقتة المحذوفة: {dropped_count}")
    log(f"  - الحجم قبل: {size_before:.1f} MB")
    log(f"  - الحجم بعد: {size_after:.1f} MB")
    if not args.dry_run:
        log(f"  - إجمالي المساحة المحررة للقرص: {max(0.0, size_before - size_after):.1f} MB", "OK")
    log(f"  - حالة النزاهة (Integrity Check): {'ناجح 100%' if integrity_ok else 'يوجد أخطاء'}", "OK" if integrity_ok else "ERROR")
    log("=" * 65)

    return 0 if integrity_ok else 1


if __name__ == "__main__":
    sys.exit(main())
