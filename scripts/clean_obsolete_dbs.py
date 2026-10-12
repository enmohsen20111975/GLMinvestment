#!/usr/bin/env python3
"""
clean_obsolete_dbs.py — أداة تطهير وتنظيف قواعد البيانات والملفات المهملة
========================================================================
الهدف: فحص مجلد db/ وحذف أي ملفات تالفة (.corrupt)، نسخ احتياطية قديمة عشوائية (*_backup_*.db)،
ملفات الـ Snapshot المهملة (market.db)، أو ملفات WAL/SHM اليتيمة، مع حماية قواعد الإنتاج الـ 10 الحية بنسبة 100%.

الاستخدام:
  python3 scripts/clean_obsolete_dbs.py              # وضع المعاينة (Dry-Run) فقط
  python3 scripts/clean_obsolete_dbs.py --execute    # التنفيذ الفعلي وحذف الملفات
"""

import os
import sys
import glob
import argparse
from pathlib import Path

# مجلد المشروع ومجلد قواعد البيانات
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"

# ══════════════════════════════════════════════════════════════════
# القائمة البيضاء المحمية (Production Canonical Whitelist)
# هذه القواعد هي عصب المنظومة الحية ويُمنع مسحها نهائياً تحت أي ظرف
# ══════════════════════════════════════════════════════════════════
PROTECTED_DBS = {
    "stocks.db",
    "data_engine.db",
    "price_history.db",
    "predictions.db",
    "intraday.db",
    "auth.db",
    "news.db",
    "crypto.db",
    "paper_trading.db",
    "metrics.db",
}

# أنماط الملفات المهملة والميتة
JUNK_PATTERNS = [
    # ملفات تالفة
    "*.corrupt*",
    "*.corrupted*",
    # نسخ احتياطية مؤقتة وعشوائية
    "*.audit-backup*",
    "*.bak.*",
    "*.bak",
    "stocks_backup_*.db*",
    "*_backup_*.db*",
    # ملفات مسودة أو غير مستخدمة
    "market.db*",
    "egypt_stocks.db*",
    "debug_screenshot.png",
]

def format_bytes(size_bytes: int) -> str:
    """تنسيق حجم الملف بوحدات قابلة للقراءة."""
    for unit in ['B', 'KB', 'MB', 'GB']:
        if size_bytes < 1024.0:
            return f"{size_bytes:3.1f} {unit}"
        size_bytes /= 1024.0
    return f"{size_bytes:.1f} TB"

def find_junk_files() -> list[Path]:
    """البحث عن جميع الملفات المهملة والتالفة داخل db/."""
    candidates = set()
    
    # 1. البحث بالأنماط المحددة في مجلد db/
    for pattern in JUNK_PATTERNS:
        for p in DB_DIR.glob(pattern):
            if p.is_file():
                candidates.add(p)
                
    # 2. البحث في db/archive إن وجد
    archive_dir = DB_DIR / "archive"
    if archive_dir.exists() and archive_dir.is_dir():
        for p in archive_dir.glob("*.db*"):
            if p.is_file():
                candidates.add(p)

    # 3. فحص ملفات SHM و WAL اليتيمة (ملف wal أو shm وقاعدته غير موجودة)
    for p in DB_DIR.glob("*.db-*"):
        base_name = p.name.split("-")[0]
        base_db = DB_DIR / base_name
        if not base_db.exists():
            candidates.add(p)

    # فلترة نهائية: استبعاد أي ملف ينتمي للقائمة المحمية
    safe_to_delete = []
    for p in candidates:
        # تأكد أن اسم الملف ليس قاعدة بيانات محمية ولا شقيق (-wal أو -shm) لقاعدة محمية صالحة
        is_protected = False
        for prot in PROTECTED_DBS:
            if p.name == prot or p.name == f"{prot}-wal" or p.name == f"{prot}-shm":
                is_protected = True
                break
        
        if not is_protected:
            safe_to_delete.append(p)
            
    return sorted(safe_to_delete)

def run(execute: bool = False):
    print("=" * 70)
    print("🧹 GLM INVESTMENT — DATABASE CLEANER & JUNK PURGE UTILITY")
    print("=" * 70)
    print(f"📁 مسار الفحص: {DB_DIR}")
    print(f"🛡️  القواعد المحمية المعتمدة: {', '.join(sorted(PROTECTED_DBS))}")
    print("-" * 70)

    junk_files = find_junk_files()

    if not junk_files:
        print("✅ مجلد قواعد البيانات نظيف تماماً! لا توجد ملفات تالفة أو مهملة.")
        print("=" * 70)
        return

    total_bytes = 0
    print(f"\n⚠️  تم العثور على {len(junk_files)} ملف مهمل/تالف:")
    print("-" * 70)
    print(f"{'اسم الملف':<45} | {'الحجم':<10} | {'المسار النسبي'}")
    print("-" * 70)

    for f in junk_files:
        try:
            sz = f.stat().st_size
            total_bytes += sz
            rel_path = f.relative_to(PROJECT_ROOT)
            print(f"{f.name:<45} | {format_bytes(sz):<10} | {rel_path}")
        except Exception as e:
            print(f"{f.name:<45} | خطأ: {e}")

    print("-" * 70)
    print(f"📊 إجمالي المساحة المهدرة القابلة للاسترجاع: {format_bytes(total_bytes)}")
    print("-" * 70)

    if not execute:
        print("\n🔍 أنت الآن في وضع المعاينة (DRY-RUN). لم يتم حذف أي ملف.")
        print("💡 لتنفيذ الحذف الفعلي واسترجاع المساحة، شغل الأمر التالي:")
        print(f"   python3 scripts/clean_obsolete_dbs.py --execute\n")
    else:
        print("\n⏳ جاري حذف الملفات واسترجاع المساحة...")
        deleted_count = 0
        freed_bytes = 0
        for f in junk_files:
            try:
                sz = f.stat().st_size
                f.unlink()
                deleted_count += 1
                freed_bytes += sz
                print(f"  ✓ تم حذف: {f.name}")
            except Exception as e:
                print(f"  ✗ فشل حذف {f.name}: {e}")

        print("=" * 70)
        print(f"🎉 اكتمل التطهير بنجاح!")
        print(f"🗑️  عدد الملفات المحذوفة: {deleted_count}/{len(junk_files)}")
        print(f"💾 المساحة المسترجعة: {format_bytes(freed_bytes)}")
        print("=" * 70)

if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Clean obsolete and corrupted database files.")
    parser.add_argument("--execute", action="store_true", help="Execute the deletion of junk files.")
    args = parser.parse_args()

    run(execute=args.execute)
