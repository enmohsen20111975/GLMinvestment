#!/usr/bin/env python3
"""
Restore Databases from Local Archive (SAFE)
=============================================
يسترجع قواعد البيانات من أرشيف محلي (databases_backup.tar.gz).

الخطوات:
  1. نسخة احتياطية لكل DB إنتاجي حالي (إلى db/backups/restore_TIMESTAMP/)
  2. استخراج الأرشيف إلى مجلد مؤقت
  3. التحقق من صحة كل DB (SQLite read-only check)
  4. استبدال كل DB بالنسخة المحلية
  5. تشغيل V40 migration على predictions.db (إذا لزم)
  6. طباعة ملخص النتائج

الاستخدام:
  # إذا كان الملف عندك على السيرفر:
  python3 vps-service/tools/restore_from_local.py --archive /path/to/databases_backup.tar.gz

  # إذا كان الملف في db/ :
  python3 vps-service/tools/restore_from_local.py --archive db/databases_backup.tar.gz

  # فحص فقط بدون استبدال:
  python3 vps-service/tools/restore_from_local.py --archive PATH --check

  # استبدال بدون نسخ احتياطي (غير موصى به):
  python3 vps-service/tools/restore_from_local.py --archive PATH --no-backup

أمان:
  - نسخة احتياطية تلقائية لكل DB قبل الاستبدال
  - التحقق من صحة كل DB قبل النسخ
  - يمكن التراجع من db/backups/restore_TIMESTAMP/
"""
import sqlite3
import os
import sys
import shutil
import argparse
import tarfile
import tempfile
import time
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# All databases that should be in the archive
EXPECTED_DBS = [
    'predictions.db',
    'stocks.db',
    'data_engine.db',
    'intraday.db',
    'price_history.db',
    'historical.db',
    'auth.db',
    'analytics.db',
    'crypto.db',
    'crypto_learning.db',
    'crypto-lab.db',
    'custom.db',
    'gold_prices.db',
    'learned.db',
    'news.db',
    'telegram_data.db',
    'community.db',
    'ai_search_cache.db',
]


def validate_db(db_path):
    """Validate a SQLite database file. Returns (valid, table_count, size_bytes)."""
    if not db_path.exists():
        return (False, 0, 0)
    size = db_path.stat().st_size
    if size < 100:
        return (False, 0, size)
    try:
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=3)
        tables = db.execute(
            "SELECT COUNT(*) FROM sqlite_master WHERE type='table'"
        ).fetchone()[0]
        db.close()
        return (True, tables, size)
    except Exception as e:
        return (False, 0, size)


def backup_current_dbs(backup_dir):
    """Backup all current production DBs to backup_dir."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    backed_up = []
    for db_name in EXPECTED_DBS:
        src = DB_DIR / db_name
        if src.exists() and src.stat().st_size > 0:
            dst = backup_dir / db_name
            shutil.copy2(str(src), str(dst))
            backed_up.append((db_name, src.stat().st_size))
    return backed_up


def extract_archive(archive_path, extract_dir):
    """Extract tar.gz archive to extract_dir."""
    try:
        with tarfile.open(str(archive_path), 'r:gz') as tar:
            tar.extractall(str(extract_dir), filter='data')
            return tar.getnames()
    except Exception as e:
        print(f"❌ فشل فك الضغط: {e}")
        return []


def find_archive_blob():
    """Find databases_backup.tar.gz in git history. Returns blob hash or None."""
    import subprocess
    try:
        result = subprocess.run(
            ['git', 'rev-list', '--all', '--objects'],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=10
        )
        if result.returncode != 0:
            return None
        for line in result.stdout.splitlines():
            parts = line.split(' ', 1)
            if len(parts) == 2 and parts[1] == 'db/databases_backup.tar.gz':
                return parts[0]
    except Exception:
        pass
    return None


def extract_archive_from_git(blob_hash, extract_dir):
    """Extract tar.gz archive from git blob to extract_dir."""
    import subprocess
    try:
        # Write blob to temp file
        temp_tar = extract_dir / '_archive.tar.gz'
        result = subprocess.run(
            ['git', 'cat-file', '-p', blob_hash],
            capture_output=True, cwd=str(PROJECT_ROOT), timeout=120
        )
        if result.returncode != 0:
            print(f"❌ فشل استخراج blob من git: {result.stderr.decode()}")
            return []
        temp_tar.write_bytes(result.stdout)

        # Extract
        with tarfile.open(str(temp_tar), 'r:gz') as tar:
            tar.extractall(str(extract_dir), filter='data')
            names = tar.getnames()
        temp_tar.unlink()
        return names
    except Exception as e:
        print(f"❌ فشل فك الضغط من git: {e}")
        return []


def run_v40_migration():
    """Run V40 migration on predictions.db (adds evidence_count, morning_bell, kill_filter_result)."""
    try:
        import sys as _sys
        _sys.path.insert(0, str(PROJECT_ROOT / 'vps-service'))
        os.environ['BYPASS_PRED_CAP'] = '1'
        from analyzers.prediction_tracker import PredictionTracker
        pt = PredictionTracker(str(DB_DIR / 'predictions.db'))
        return True
    except Exception as e:
        print(f"⚠️  V40 migration failed: {e}")
        return False


def main():
    parser = argparse.ArgumentParser(description='Restore databases from local archive')
    parser.add_argument('--archive', help='مسار ملف databases_backup.tar.gz')
    parser.add_argument('--check', action='store_true', help='فحص فقط بدون استبدال')
    parser.add_argument('--no-backup', action='store_true', help='عدم عمل نسخة احتياطية')
    parser.add_argument('--from-git', action='store_true',
                        help='استخراج الأرشيف من git history (بدون تحميل)')
    args = parser.parse_args()

    print("=" * 70)
    print("  Restore Databases from Local Archive")
    print("=" * 70)

    # Determine source: --archive PATH, --from-git, or auto-detect
    use_git = False
    archive_path = None
    blob_hash = None

    if args.from_git:
        # Explicit: use git history
        blob_hash = find_archive_blob()
        if not blob_hash:
            print("\n❌ لم يتم العثور على databases_backup.tar.gz في git history")
            return 1
        print(f"\n📦 المصدر: git history (blob {blob_hash[:12]})")
        use_git = True
    elif args.archive:
        archive_path = Path(args.archive).resolve()
        if not archive_path.exists():
            print(f"\n❌ الملف غير موجود: {archive_path}")
            return 1
        size_mb = archive_path.stat().st_size / (1024 * 1024)
        print(f"\n📦 المصدر: ملف محلي")
        print(f"   المسار: {archive_path}")
        print(f"   الحجم: {size_mb:.1f} MB")
    else:
        # Auto-detect: try local file first, then git history
        local_default = DB_DIR / 'databases_backup.tar.gz'
        if local_default.exists() and local_default.stat().st_size > 1000:
            archive_path = local_default
            size_mb = archive_path.stat().st_size / (1024 * 1024)
            print(f"\n📦 المصدر (auto): ملف محلي")
            print(f"   المسار: {archive_path}")
            print(f"   الحجم: {size_mb:.1f} MB")
        else:
            blob_hash = find_archive_blob()
            if blob_hash:
                print(f"\n📦 المصدر (auto): git history (blob {blob_hash[:12]})")
                use_git = True
            else:
                print("\n❌ لم يتم العثور على الأرشيف!")
                print("   الخيارات:")
                print("   1. --archive /path/to/databases_backup.tar.gz")
                print("   2. --from-git (يستخرج من git history)")
                print("   3. ضع الملف في db/databases_backup.tar.gz")
                return 1

    # Get blob size for display
    if use_git:
        import subprocess
        size_result = subprocess.run(
            ['git', 'cat-file', '-s', blob_hash],
            capture_output=True, text=True, cwd=str(PROJECT_ROOT), timeout=10
        )
        if size_result.returncode == 0:
            size_mb = int(size_result.stdout.strip()) / (1024 * 1024)
            print(f"   الحجم: {size_mb:.1f} MB")

    # 2. Extract to temp
    with tempfile.TemporaryDirectory() as tmp:
        extract_dir = Path(tmp)

        if use_git:
            print(f"\n📂 استخراج من git إلى {extract_dir}...")
            files = extract_archive_from_git(blob_hash, extract_dir)
        else:
            print(f"\n📂 فك الضغط إلى {extract_dir}...")
            files = extract_archive(archive_path, extract_dir)

        if not files:
            print("❌ فشل فك الضغط أو الأرشيف فارغ")
            return 1
        print(f"   تم استخراج {len(files)} ملف")

        # Find extracted DBs (they're under db/ in the archive)
        extracted_dbs = {}
        for f in files:
            if f.endswith('.db'):
                db_name = os.path.basename(f)
                db_path = extract_dir / f
                if db_path.exists():
                    extracted_dbs[db_name] = db_path

        print(f"\n📋 قواعد البيانات في الأرشيف: {len(extracted_dbs)}")
        for name in sorted(extracted_dbs.keys()):
            valid, tables, size = validate_db(extracted_dbs[name])
            status = '✅' if valid else '❌'
            print(f"   {status} {name} ({size:,} bytes, {tables} tables)")

        if args.check:
            print(f"\n📋 وضع الفحص — لن يتم التعديل")
            print(f"\n📊 الحالة الحالية في db/:")
            for name in EXPECTED_DBS:
                current = DB_DIR / name
                if current.exists():
                    valid, tables, size = validate_db(current)
                    status = '✅' if valid else '⚠️'
                    print(f"   {status} {name} ({size:,} bytes, {tables} tables)")
                else:
                    print(f"   ❌ {name}: غير موجود")
            return 0

        # 3. Backup current DBs
        if not args.no_backup:
            timestamp = int(time.time())
            backup_dir = DB_DIR / 'backups' / f'restore_{timestamp}'
            print(f"\n💾 نسخة احتياطية للقواعد الحالية → {backup_dir}")
            backed_up = backup_current_dbs(backup_dir)
            print(f"   تم نسخ {len(backed_up)} ملف")
            for name, size in backed_up:
                print(f"   • {name} ({size:,} bytes)")
        else:
            print(f"\n⚠️  --no-backup: لن يتم عمل نسخة احتياطية")

        # 4. Replace each DB
        print(f"\n🔄 استبدال قواعد البيانات...")
        replaced = []
        failed = []

        for name in EXPECTED_DBS:
            if name not in extracted_dbs:
                print(f"   ⚠️  {name}: غير موجود في الأرشيف — تخطي")
                continue

            src = extracted_dbs[name]
            dst = DB_DIR / name

            # Validate source
            valid, tables, size = validate_db(src)
            if not valid:
                print(f"   ❌ {name}: الأرشيف contains invalid DB — تخطي")
                failed.append(name)
                continue

            # Copy
            try:
                shutil.copy2(str(src), str(dst))
                print(f"   ✅ {name}: {size:,} bytes, {tables} tables")
                replaced.append(name)
            except Exception as e:
                print(f"   ❌ {name}: فشل النسخ — {e}")
                failed.append(name)

        # 5. V40 migration on predictions.db
        if 'predictions.db' in replaced:
            print(f"\n🔧 تشغيل V40 migration على predictions.db...")
            if run_v40_migration():
                print(f"   ✅ V40 migration complete")
            else:
                print(f"   ⚠️  V40 migration failed (see above)")

        # 6. Verify price_history.db specifically
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

        # Summary
        print(f"\n" + "=" * 70)
        print(f"  Summary")
        print(f"=" * 70)
        print(f"  ✅ استُبدل: {len(replaced)} ملف")
        for f in replaced:
            print(f"     • {f}")
        if failed:
            print(f"  ❌ فشل: {len(failed)} ملف")
            for f in failed:
                print(f"     • {f}")

        if not args.no_backup:
            print(f"\n💾 النسخة الاحتياطية في: {backup_dir}")
            print(f"   للتراجع: cp {backup_dir}/*.db db/")

        print(f"\n🎯 الخطوة التالية:")
        print(f"   python3 vps-service/jobs/daily_predictor.py --yesterday-only")

        return 0 if replaced else 1


if __name__ == '__main__':
    sys.exit(main())
