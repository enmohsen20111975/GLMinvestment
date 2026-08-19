#!/usr/bin/env python3
"""
Restore Databases from Archive
================================
يسترجع ملفات قواعد البيانات الكبيرة من أرشيف active_databases_max_lzma.zip.

مصادر الأرشيف (بترتيب الأولوية):
  1. --archive PATH (مسار صريح)
  2. db/active_databases_max_lzma.zip (ملف محلي)
  3. git history (blob 84ad917 — قبل commit ca9427e)

يسترجع فقط الملفات الآمنة (لا يكتب فوق DBs الحساسة):
  ✅ price_history.db    (276K صف — بيانات الأسعار)
  ✅ historical.db       (175K صف — أسعار تاريخية)
  ✅ intraday.db         (75 MB — بيانات اليوم)
  ✅ data_engine.db      (6.5 MB — بيانات المحرك)
  ✅ stocks.db           (11 MB — قائمة الأسهم + stock_daily_prices)

  ❌ predictions.db      (له بيانات V40 حديثة — لا تكتب فوقها)
  ❌ auth.db             (له sessions/users حديثة)
  ❌ community.db        (له posts/comments حديثة)
  ❌ crypto-lab.db       (له trades حديثة)
  ❌ crypto_learning.db  (له lessons حديثة)

الاستخدام:
  python3 vps-service/tools/restore_dbs.py                    # من git history
  python3 vps-service/tools/restore_dbs.py --archive PATH     # من ملف محلي
  python3 vps-service/tools/restore_dbs.py --check            # فحص فقط
  python3 vps-service/tools/restore_dbs.py --include predictions.db  # استرجاع ملف محظور
"""
import sqlite3
import os
import sys
import shutil
import argparse
import subprocess
import zipfile
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
ARCHIVE_LOCAL = DB_DIR / 'active_databases_max_lzma.zip'

# Git blob hash of the archive (before commit ca9427e untracked it)
GIT_BLOB = '84ad917d97e4b4c9822ce614abf6c790109c7cbd'

# Files safe to restore (large data DBs without live user data)
SAFE_TO_RESTORE = {
    'price_history.db',
    'historical.db',
    'intraday.db',
    'data_engine.db',
    'stocks.db',
}

# Files NEVER to overwrite (contain live/unique data)
PROTECTED = {
    'predictions.db',       # V40 migration done — has evidence_count/morning_bell
    'auth.db',              # live sessions
    'community.db',         # live posts
    'crypto-lab.db',        # live trades
    'crypto_learning.db',   # live lessons
    'learned.db',           # live lessons
    'ai_search_cache.db',   # cache (harmless but no need)
    'analytics.db',         # live analytics
}


def find_archive(explicit_path=None):
    """Find the archive file: explicit path > local > git history."""
    candidates = []

    if explicit_path:
        p = Path(explicit_path)
        if p.exists():
            candidates.append(('explicit', p))
        else:
            print(f"❌ المسار المحدد غير موجود: {p}")

    if ARCHIVE_LOCAL.exists():
        candidates.append(('local', ARCHIVE_LOCAL))

    # Try git history
    try:
        result = subprocess.run(
            ['git', 'cat-file', '-t', GIT_BLOB],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=10
        )
        if result.returncode == 0 and result.stdout.strip() == 'blob':
            candidates.append(('git-history', GIT_BLOB))
    except Exception:
        pass

    return candidates


def extract_archive_to_temp(archive_info, temp_dir):
    """Extract archive (from path or git blob) to temp dir. Returns list of db files."""
    source_type, source = archive_info

    if source_type == 'git-history':
        # Write blob to temp file
        temp_zip = temp_dir / 'archive.zip'
        result = subprocess.run(
            ['git', 'cat-file', '-p', GIT_BLOB],
            capture_output=True, cwd=str(PROJECT_ROOT), timeout=60
        )
        if result.returncode != 0:
            print(f"❌ فشل استخراج الأرشيف من git: {result.stderr.decode()}")
            return []
        temp_zip.write_bytes(result.stdout)
        zip_path = temp_zip
    else:
        zip_path = source

    # Extract (LZMA-compressed zip requires Python's zipfile, not unzip CLI)
    try:
        with zipfile.ZipFile(str(zip_path), 'r', allowZip64=True) as z:
            z.extractall(str(temp_dir))
            return z.namelist()
    except Exception as e:
        print(f"❌ فشل فك الضغط: {e}")
        return []


def check_db_valid(db_path):
    """Verify a .db file is a valid SQLite database with data."""
    if not db_path.exists() or db_path.stat().st_size < 1000:
        return {'valid': False, 'reason': 'file too small or missing'}

    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=3)
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        db.close()
        return {'valid': True, 'tables': len(tables), 'size': db_path.stat().st_size}
    except Exception as e:
        return {'valid': False, 'reason': str(e)}


def main():
    parser = argparse.ArgumentParser(description='Restore databases from archive')
    parser.add_argument('--archive', help='مسار الأرشيف صراحةً')
    parser.add_argument('--check', action='store_true', help='فحص فقط بدون استرجاع')
    parser.add_argument('--include', action='append', default=[],
                        help='استرجاع ملف محظور (مثل: --include predictions.db)')
    parser.add_argument('--no-backup', action='store_true', help='عدم عمل backup للملفات الحالية')
    args = parser.parse_args()

    print("=" * 70)
    print("  Restore Databases from Archive")
    print("=" * 70)

    # Find archive
    candidates = find_archive(args.archive)
    if not candidates:
        print("\n❌ لم يتم العثور على الأرشيف!")
        print("   الخيارات:")
        print("   1. مرّر --archive /path/to/active_databases_max_lzma.zip")
        print("   2. ضع الملف في db/active_databases_max_lzma.zip")
        print("   3. تأكد أن git history يحتوي على blob 84ad917")
        return 1

    print(f"\n📦 مصادر الأرشيف المتاحة:")
    for stype, spath in candidates:
        print(f"   • {stype}: {spath}")

    chosen = candidates[0]
    print(f"\n👉 سيُستخدم: {chosen[0]}")

    if args.check:
        print("\n📋 وضع الفحص — لن يتم التعديل")

    # Determine which files to restore
    extra_include = set(args.include)
    to_restore = SAFE_TO_RESTORE | extra_include

    print(f"\n📋 الملفات المراد استرجاعها:")
    for f in sorted(to_restore):
        marker = '✅' if f in SAFE_TO_RESTORE else '⚠️  (محمي — فرض استرجاع)'
        print(f"   {marker} {f}")

    print(f"\n🚫 الملفات المحمية (لن تُكتب فوقها):")
    for f in sorted(PROTECTED - extra_include):
        print(f"   ❌ {f}")

    if args.check:
        # Show current state
        print(f"\n📊 الحالة الحالية في db/:")
        for f in sorted(to_restore):
            p = DB_DIR / f
            if p.exists():
                info = check_db_valid(p)
                if info['valid']:
                    print(f"   {f}: {info['size']:,} bytes, {info['tables']} tables")
                else:
                    print(f"   {f}: ⚠️  {info.get('reason', 'invalid')}")
            else:
                print(f"   {f}: ❌ غير موجود")
        return 0

    # Extract archive to temp
    import tempfile
    with tempfile.TemporaryDirectory() as tmp:
        temp_dir = Path(tmp)
        print(f"\n📂 فك ضغط الأرشيف إلى {temp_dir}...")
        files = extract_archive_to_temp(chosen, temp_dir)
        if not files:
            print("❌ فشل فك الضغط")
            return 1
        print(f"   تم استخراج {len(files)} ملف")

        # Restore each file
        restored = []
        skipped = []

        for f in sorted(to_restore):
            src = temp_dir / f
            dst = DB_DIR / f

            if not src.exists():
                print(f"\n⚠️  {f}: غير موجود في الأرشيف — تخطي")
                skipped.append(f)
                continue

            # Validate source
            src_info = check_db_valid(src)
            if not src_info['valid']:
                print(f"\n⚠️  {f}: الأرشيف contains invalid DB — تخطي ({src_info.get('reason')})")
                skipped.append(f)
                continue

            # Backup existing
            if dst.exists() and not args.no_backup:
                backup = dst.with_suffix(f'.db.bak_restore_{int(__import__("time").time())}')
                shutil.copy2(str(dst), str(backup))
                print(f"\n📦 {f}: backup → {backup.name}")

            # Copy
            shutil.copy2(str(src), str(dst))
            size_mb = dst.stat().st_size / (1024 * 1024)
            print(f"✅ {f}: استُرجع ({size_mb:.1f} MB, {src_info['tables']} tables)")
            restored.append(f)

        # Summary
        print(f"\n" + "=" * 70)
        print(f"  Summary")
        print(f"=" * 70)
        print(f"  ✅ استُرجع: {len(restored)} ملف")
        for f in restored:
            print(f"     • {f}")
        if skipped:
            print(f"  ⚠️  تخطي: {len(skipped)} ملف")
            for f in skipped:
                print(f"     • {f}")

        # Verify price_history specifically
        ph = DB_DIR / 'price_history.db'
        if ph.exists():
            try:
                db = sqlite3.connect(f'file:{ph}?mode=ro', uri=True, timeout=3)
                tables = [r[0] for r in db.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()]
                if 'price_history' in tables:
                    cnt = db.execute('SELECT COUNT(*) FROM price_history').fetchone()[0]
                    tickers = db.execute(
                        'SELECT COUNT(DISTINCT ticker) FROM price_history'
                    ).fetchone()[0]
                    rng = db.execute(
                        'SELECT MIN(date), MAX(date) FROM price_history'
                    ).fetchone()
                    print(f"\n📊 price_history.db جاهز:")
                    print(f"   الصفوف: {cnt:,}")
                    print(f"   الأسهم: {tickers:,}")
                    print(f"   النطاق: {rng[0]} → {rng[1]}")
                db.close()
            except Exception as e:
                print(f"\n⚠️  خطأ في التحقق من price_history.db: {e}")

        return 0 if restored else 1


if __name__ == '__main__':
    sys.exit(main())
