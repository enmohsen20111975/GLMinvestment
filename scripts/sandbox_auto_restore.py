#!/usr/bin/env python3
"""
sandbox_auto_restore.py — استرداد DBs تلقائياً بعد reset الساندبوكس
=====================================================================
Task IMPROVEMENT-16-2026-10-07 (Rule 71)

الهدف:
  لما الساندبوكس يعمل reset، الـ DBs بتختفي (migrator بيأنشئها فاضية).
  السكريبت ده بـ:
    1. يفحص لو الـ DBs فاضية (أو حجمها صغير جداً)
    2. يستخرج آخر DB backup من تاريخ GitHub
    3. يفك الضغط في db/
    4. يعيد تشغيل Python backend

استخدام:
  python3 scripts/sandbox_auto_restore.py
  python3 scripts/sandbox_auto_restore.py --force  (حتى لو الـ DBs مش فاضية)

أو تلقائياً عند بداية كل جلسة:
  if [ -f scripts/sandbox_auto_restore.py ]; then
    python3 scripts/sandbox_auto_restore.py
  fi
"""
from __future__ import annotations

import os
import sys
import sqlite3
import subprocess
import zipfile
import json
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(PROJECT_ROOT / "vps-service"))

DB_DIR = PROJECT_ROOT / "db"
DATA_DIR = PROJECT_ROOT / "data"
CRITICAL_DBS = ['stocks.db', 'predictions.db', 'price_history.db', 'data_engine.db', 'auth.db']
MIN_DB_SIZE = 100_000  # 100KB — لو أقل، يعتبر فاضي
GITHUB_TOKEN = os.environ.get('GITHUB_TOKEN', '')  # من .env أو export


def log(msg: str):
    print(f"[auto-restore] {msg}", flush=True)


def check_db_health() -> dict:
    """فحص صحة الـ DBs الحالية."""
    health = {}
    for db_name in CRITICAL_DBS:
        db_path = DB_DIR / db_name
        if not db_path.exists():
            health[db_name] = {'status': 'missing', 'size': 0, 'rows': 0}
            continue

        size = db_path.stat().st_size
        if size < MIN_DB_SIZE:
            health[db_name] = {'status': 'empty', 'size': size, 'rows': 0}
            continue

        # count rows in main table
        try:
            # Phase 7.1: migrated to db_manager (writable=False)
            from core.db_manager import db_manager
            conn = db_manager.connection(str(db_path), writable=False).__enter__()
            tables = conn.execute("SELECT name FROM sqlite_master WHERE type='table'").fetchall()
            main_table = None
            for t in tables:
                if t[0] in ('predictions', 'stock_daily_prices', 'price_history', 'stocks', 'historical_data', 'User'):
                    main_table = t[0]
                    break
            if main_table:
                rows = conn.execute(f'SELECT COUNT(*) FROM "{main_table}"').fetchone()[0]
            else:
                rows = 0
            conn.close()
            health[db_name] = {'status': 'ok' if rows > 0 else 'empty', 'size': size, 'rows': rows}
        except Exception as e:
            health[db_name] = {'status': 'corrupt', 'size': size, 'rows': 0, 'error': str(e)}

    return health


def needs_restore(health: dict, force: bool = False) -> bool:
    """تحديد لو محتاجين restore."""
    if force:
        return True

    for db_name in CRITICAL_DBS:
        status = health.get(db_name, {}).get('status', 'missing')
        if status in ('missing', 'empty', 'corrupt'):
            return True

    return False


def find_latest_backup_on_github() -> str:
    """البحث عن آخر backup zip على GitHub."""
    try:
        # git log للبحث عن آخر commit فيها data/*.zip
        cmd = ['git', 'log', '--all', '--oneline', '--name-only', '--diff-filter=A',
               '--pretty=format:COMMIT:%H', '--', 'data/']
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))

        # ابحث عن آخر zip file
        latest_zip = None
        for line in result.stdout.split('\n'):
            line = line.strip()
            if line.startswith('data/') and (line.endswith('.zip') or '.zip.part' in line):
                latest_zip = line
            # نوقف عند أول ملف .zip (مش .part)

        # نفضل الـ zip files الكاملة (مش split parts)
        all_zips = []
        in_commit = False
        for line in result.stdout.split('\n'):
            if line.startswith('COMMIT:'):
                in_commit = True
                continue
            if in_commit and line.strip().startswith('data/') and line.strip().endswith('.zip'):
                all_zips.append(line.strip())
                in_commit = False

        # نرجع أول zip (الأحدث)
        if all_zips:
            return all_zips[0]

        return None
    except Exception as e:
        log(f"Error finding backup: {e}")
        return None


def find_latest_backup_parts() -> list:
    """البحث عن آخر backup parts على GitHub (من origin/main tree)."""
    try:
        # استخدم git ls-tree لجلب كل ملفات data/
        cmd = ['git', 'ls-tree', 'origin/main', 'data/']
        result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))

        if result.returncode != 0:
            log(f"git ls-tree failed: {result.stderr}")
            return []

        # اجمع كل ملفات db_backup_*
        all_backup_files = []
        for line in result.stdout.strip().split('\n'):
            if not line:
                continue
            # Format: <mode> <type> <hash>\t<path>
            parts = line.split('\t')
            if len(parts) < 2:
                continue
            filepath = parts[1]
            if 'db_backup_' in filepath and (filepath.endswith('.zip') or '.zip.part' in filepath):
                all_backup_files.append(filepath)

        if not all_backup_files:
            return []

        # اوجد أحدث timestamp في أسماء الملفات
        # Format: data/db_backup_2026-10-06T16-51-36_part1.zip
        timestamps = {}
        for filepath in all_backup_files:
            filename = Path(filepath).name
            if 'db_backup_' in filename:
                ts_start = filename.find('db_backup_') + len('db_backup_')
                ts_end = filename.find('_part', ts_start)
                if ts_end < 0:
                    ts_end = filename.find('.zip', ts_start)
                if ts_end > ts_start:
                    ts = filename[ts_start:ts_end]
                    if ts not in timestamps:
                        timestamps[ts] = []
                    timestamps[ts].append(filepath)

        if not timestamps:
            return []

        # أحدث timestamp
        latest_ts = sorted(timestamps.keys(), reverse=True)[0]
        log(f"Latest backup timestamp: {latest_ts} ({len(timestamps[latest_ts])} files)")
        return timestamps[latest_ts]
    except Exception as e:
        log(f"Error finding backup parts: {e}")
        return []


def restore_from_github(force: bool = False):
    """استرجاع DBs من GitHub."""
    log("═══ Sandbox Auto-Restore ═══")
    log(f"Time: {datetime.now().isoformat()}")
    log("")

    # 1) فحص صحة الـ DBs الحالية
    health = check_db_health()
    log("=== DB Health Check ===")
    for db_name, info in health.items():
        status_emoji = {'ok': '✅', 'empty': '⚠️', 'missing': '❌', 'corrupt': '🔴'}.get(info['status'], '?')
        log(f"  {status_emoji} {db_name}: {info['status']} (size={info['size']:,}, rows={info['rows']:,})")

    if not needs_restore(health, force):
        log("")
        log("✅ All critical DBs are healthy — no restore needed")
        return True

    log("")
    log("⚠️ Some DBs need restore — searching GitHub for latest backup...")

    # 2) البحث عن آخر backup على GitHub
    # أولاً: نفحص لو فيه ملفات zip محلية في data/
    local_zips = list(DATA_DIR.glob("db_backup_*.zip"))
    if local_zips:
        latest_local = max(local_zips, key=lambda f: f.stat().st_mtime)
        log(f"📁 Found local backup: {latest_local.name}")
        # استخراج
        success = extract_backup(latest_local)
        if success:
            log("")
            log("✅ Restore complete from local backup")
            verify_restore()
            return True

    # ثانياً: ابحث في تاريخ GitHub
    backup_parts = find_latest_backup_parts()
    if not backup_parts:
        log("❌ No backup found on GitHub or locally")
        return False

    log(f"📁 Found {len(backup_parts)} backup files on GitHub (latest timestamp)")

    # 3) استخراج كل ملفات الـ backup
    # نستخدم git show لاستخراج كل ملف
    success_count = 0
    for filepath in backup_parts:
        try:
            # git show origin/main:<filepath> > data/<filename>
            filename = Path(filepath).name
            local_path = DATA_DIR / filename

            cmd = ['git', 'show', f'origin/main:{filepath}']
            result = subprocess.run(cmd, capture_output=True, cwd=str(PROJECT_ROOT))

            if result.returncode == 0:
                local_path.write_bytes(result.stdout)
                log(f"  ✅ Downloaded: {filename} ({len(result.stdout):,} bytes)")
                success_count += 1
            else:
                log(f"  ❌ Failed: {filename}")
        except Exception as e:
            log(f"  ❌ Error: {filepath}: {e}")

    if success_count == 0:
        log("❌ No files downloaded — restore failed")
        return False

    # 4) فك الضغط
    log("")
    log("=== Extracting backups ===")

    # استخراج ملفات zip الكاملة
    zip_files = sorted(DATA_DIR.glob("db_backup_*.zip"))
    for zip_path in zip_files:
        extract_backup(zip_path)

    # دمج split parts + استخراج
    part_files = sorted(DATA_DIR.glob("db_backup_*_split_*.zip.part"))
    if part_files:
        # اجمع الـ parts حسب الـ prefix (بدون _split_XX)
        prefixes = set()
        for p in part_files:
            name = p.name
            prefix = name.split('_split_')[0]
            prefixes.add(prefix)

        for prefix in sorted(prefixes):
            parts = sorted(DATA_DIR.glob(f"{prefix}_split_*.zip.part"))
            if parts:
                combined_path = DATA_DIR / f"{prefix}_combined.zip"
                with open(combined_path, 'wb') as f_out:
                    for part in parts:
                        f_out.write(part.read())
                log(f"  📦 Combined: {prefix} ({len(parts)} parts → {combined_path.stat().st_size:,} bytes)")
                extract_backup(combined_path)
                # مسح الملف المدمج
                combined_path.unlink()

    # 5) التحقق
    log("")
    log("=== Verification ===")
    verify_restore()

    return True


def extract_backup(zip_path: Path) -> bool:
    """فك ضغط ملف zip في db/."""
    try:
        with zipfile.ZipFile(zip_path, 'r') as zf:
            zf.extractall(DB_DIR)
        log(f"  ✅ Extracted: {zip_path.name}")
        return True
    except Exception as e:
        log(f"  ❌ Extract failed: {zip_path.name}: {e}")
        return False


def verify_restore():
    """التحقق من نجاح الاستعادة."""
    health = check_db_health()
    for db_name, info in health.items():
        status_emoji = {'ok': '✅', 'empty': '⚠️', 'missing': '❌', 'corrupt': '🔴'}.get(info['status'], '?')
        log(f"  {status_emoji} {db_name}: {info['status']} (size={info['size']:,}, rows={info['rows']:,})")

    ok_count = sum(1 for info in health.values() if info['status'] == 'ok')
    log("")
    if ok_count == len(CRITICAL_DBS):
        log(f"✅ All {len(CRITICAL_DBS)} critical DBs restored successfully")
    else:
        log(f"⚠️ {ok_count}/{len(CRITICAL_DBS)} DBs restored — some may need manual restore")


if __name__ == '__main__':
    force = '--force' in sys.argv
    restore_from_github(force=force)
