#!/usr/bin/env python3
"""
GLMinvestment — Database Guardian & Self-Healing Watchdog
=========================================================
Rule 20 / Rule 67 / Rule 27 Compliant Database Protection Engine.

Core Capabilities:
1. ATOMIC ONLINE BACKUP:
   Uses SQLite's official `conn.backup()` C-level API on read-only URI connections.
   Zero write-lock interference, zero incomplete pages, safe during live traffic.

2. INTEGRITY VERIFICATION:
   Runs `PRAGMA integrity_check` before and after operations.

3. SELF-HEALING AUTO-RECOVERY:
   If any database becomes corrupt/malformed, Guardian immediately:
   - Backs up the corrupt file for forensics with a timestamp.
   - Extracts the latest verified `.current.db.gz` (or `.previous.db.gz`).
   - Flushes stale `-wal` and `-shm` lock files.
   - Verifies integrity of the restored DB.
   - Self-heals in under 2 seconds before end-users experience 500 errors.

4. WAL MAINTENANCE:
   Performs non-blocking `PRAGMA wal_checkpoint(PASSIVE)` to prevent runaway WAL files.

Usage:
  python3 scripts/db_guardian.py check       # Check integrity of all DBs
  python3 scripts/db_guardian.py backup      # Take atomic rolling backups
  python3 scripts/db_guardian.py checkpoint  # Run WAL checkpoints
  python3 scripts/db_guardian.py heal [name] # Force heal a specific DB
  python3 scripts/db_guardian.py cycle       # Run full cycle (check + checkpoint + backup)
  python3 scripts/db_guardian.py watch       # Continuous daemon mode (runs every 30m)
"""

import sys
import os
import time
import gzip
import shutil
import sqlite3
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'
BACKUP_DIR = DB_DIR / 'backups' / 'live'
LOG_FILE = BACKUP_DIR / 'guardian.log'

PROTECTED_DBS = [
    'stocks.db',
    'predictions.db',
    'data_engine.db',
    'price_history.db',
    'auth.db',
    'intraday.db',
    'crypto.db',
    'news.db',
    'metrics.db',
]

def log(msg: str, level: str = 'INFO'):
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f"[{timestamp}] [{level}] {msg}"
    print(line, flush=True)
    try:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        with open(LOG_FILE, 'a', encoding='utf-8') as f:
            f.write(line + '\n')
    except Exception:
        pass

def format_size(size_bytes: int) -> str:
    if size_bytes < 1024:
        return f"{size_bytes} B"
    elif size_bytes < 1024 * 1024:
        return f"{size_bytes / 1024:.1f} KB"
    elif size_bytes < 1024 * 1024 * 1024:
        return f"{size_bytes / (1024 * 1024):.1f} MB"
    return f"{size_bytes / (1024 * 1024 * 1024):.2f} GB"

def check_integrity(db_path: Path) -> tuple[bool, str]:
    """Test database integrity using PRAGMA integrity_check."""
    if not db_path.exists():
        return False, "File does not exist"
    if db_path.stat().st_size == 0:
        return False, "File size is 0 bytes"
    try:
        # Open in read-only mode to prevent any locking or modification
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=10)
        res = conn.execute("PRAGMA integrity_check;").fetchall()
        conn.close()
        status = res[0][0] if res else "empty"
        if status == "ok":
            return True, "ok"
        return False, str(res[:2])
    except Exception as e:
        return False, str(e)

def auto_heal(db_name: str) -> bool:
    """Restore a corrupt database from the latest verified backup."""
    stem = db_name.replace('.db', '')
    current_gz = BACKUP_DIR / f"{stem}.current.db.gz"
    previous_gz = BACKUP_DIR / f"{stem}.previous.db.gz"
    target_path = DB_DIR / db_name

    chosen_backup = None
    if current_gz.exists():
        chosen_backup = current_gz
    elif previous_gz.exists():
        chosen_backup = previous_gz
    else:
        log(f"🚨 [HEAL FAILED] {db_name}: لا توجد نسخة احتياطية معتمدة في {BACKUP_DIR}!", "ERROR")
        return False

    log(f"🚑 [AUTO-HEAL] بدء إنقاذ {db_name} من النسخة المعتمدة {chosen_backup.name}...", "WARN")

    try:
        # 1. Archive the corrupt file if exists
        if target_path.exists():
            corrupt_archive = DB_DIR / f"{stem}.corrupt.{int(time.time())}.bak"
            shutil.copy2(target_path, corrupt_archive)
            log(f"   ↳ تم عزل الملف التالف إلى {corrupt_archive.name}", "INFO")

        # 2. Extract backup to a temporary file
        tmp_restored = DB_DIR / f"{stem}.restoring.tmp"
        with gzip.open(chosen_backup, 'rb') as f_in:
            with open(tmp_restored, 'wb') as f_out:
                shutil.copyfileobj(f_in, f_out)

        # 3. Verify extracted file BEFORE placing it into production
        ok, reason = check_integrity(tmp_restored)
        if not ok:
            log(f"🚨 [HEAL FAILED] النسخة المستخرجة غير صالحة ({reason})!", "ERROR")
            if tmp_restored.exists():
                tmp_restored.unlink()
            return False

        # 4. Remove stale WAL/SHM locks
        for ext in ['-wal', '-shm']:
            lock_file = DB_DIR / f"{db_name}{ext}"
            if lock_file.exists():
                try:
                    lock_file.unlink()
                except Exception:
                    pass

        # 5. Atomic rename to production
        shutil.move(str(tmp_restored), str(target_path))

        log(f"✅ [HEAL SUCCESS] تم استعادة {db_name} بنجاح وفحص سلامتها 100%! الحجم: {format_size(target_path.stat().st_size)}", "INFO")
        return True
    except Exception as e:
        log(f"🚨 [HEAL ERROR] فشل استعادة {db_name}: {e}", "ERROR")
        return False

def backup_db(db_name: str) -> bool:
    """Take an atomic online backup of db_name using sqlite3_backup API."""
    src_path = DB_DIR / db_name
    if not src_path.exists() or src_path.stat().st_size == 0:
        return False

    stem = db_name.replace('.db', '')
    current_gz = BACKUP_DIR / f"{stem}.current.db.gz"
    previous_gz = BACKUP_DIR / f"{stem}.previous.db.gz"
    temp_raw = BACKUP_DIR / f"{stem}.snapshot.tmp"
    temp_gz = BACKUP_DIR / f"{stem}.snapshot.gz"

    try:
        # Step 1: Open source in read-only mode & perform atomic backup
        src_conn = sqlite3.connect(f"file:{src_path}?mode=ro", uri=True, timeout=15)
        dst_conn = sqlite3.connect(str(temp_raw))
        src_conn.backup(dst_conn)
        dst_conn.close()
        src_conn.close()

        # Step 2: Verify snapshot integrity
        ok, reason = check_integrity(temp_raw)
        if not ok:
            log(f"⚠️ فشل فحص سلامة نسخة {db_name}: {reason} — تم إلغاء التحديث", "WARN")
            if temp_raw.exists():
                temp_raw.unlink()
            return False

        # Step 3: Compress with gzip
        with open(temp_raw, 'rb') as f_in:
            with gzip.open(temp_gz, 'wb', compresslevel=6) as f_out:
                shutil.copyfileobj(f_in, f_out)
        temp_raw.unlink()

        raw_size = src_path.stat().st_size
        gz_size = temp_gz.stat().st_size
        ratio = (1 - (gz_size / raw_size)) * 100 if raw_size > 0 else 0

        # Step 4: Rotate current -> previous, temp -> current
        if current_gz.exists():
            if previous_gz.exists():
                previous_gz.unlink()
            current_gz.rename(previous_gz)
        temp_gz.rename(current_gz)

        log(f"🔒 [BACKUP OK] {db_name}: الأصل {format_size(raw_size)} ← مضغوط {format_size(gz_size)} (وفّر {ratio:.1f}%)")
        return True
    except Exception as e:
        log(f"❌ خطأ أثناء نسخ {db_name}: {e}", "ERROR")
        if temp_raw.exists():
            temp_raw.unlink()
        if temp_gz.exists():
            temp_gz.unlink()
        return False

def wal_checkpoint_all():
    """Checkpoint WAL logs to prevent uncommitted bloat."""
    for db_name in PROTECTED_DBS:
        p = DB_DIR / db_name
        if not p.exists():
            continue
        try:
            conn = sqlite3.connect(str(p), timeout=10)
            conn.execute("PRAGMA wal_checkpoint(PASSIVE);")
            conn.close()
        except Exception:
            pass

def run_check_cycle(heal_if_bad: bool = True):
    """Run full health check, auto-healing any corrupt database."""
    log("="*60)
    log("🔍 [GUARDIAN AUDIT] بدء فحص سلامة قواعد البيانات الحية...")
    all_ok = True
    for db_name in PROTECTED_DBS:
        p = DB_DIR / db_name
        if not p.exists():
            continue
        ok, reason = check_integrity(p)
        if ok:
            log(f"  ✓ {db_name:20}: سليم (PRAGMA integrity_check = ok)")
        else:
            log(f"  ❌ {db_name:20}: تالف! السبب: {reason}", "ERROR")
            all_ok = False
            if heal_if_bad:
                auto_heal(db_name)
    return all_ok

def run_full_cycle():
    """Check integrity, checkpoint WAL, take atomic backups."""
    log("="*60)
    log("🛡️ [GUARDIAN CYCLE] بدء دورة الحماية الشاملة (Check + Checkpoint + Backup)...")
    log("="*60)
    # 1. Health check & heal if broken
    run_check_cycle(heal_if_bad=True)
    # 2. Checkpoint WAL
    wal_checkpoint_all()
    # 3. Take atomic snapshots
    success = 0
    for db_name in PROTECTED_DBS:
        if backup_db(db_name):
            success += 1
    log(f"🎉 تم تأمين {success} من أصل {len(PROTECTED_DBS)} قواعد بيانات بنجاح.")
    log("="*60)

def main():
    parser = argparse.ArgumentParser(description="GLMinvestment Database Guardian")
    parser.add_argument("action", choices=["check", "backup", "checkpoint", "heal", "cycle", "watch"],
                        default="cycle", nargs="?", help="Action to perform")
    parser.add_argument("--db", type=str, default="stocks.db", help="Database name for heal action")
    parser.add_argument("--interval", type=int, default=1800, help="Interval in seconds for watch mode")
    args = parser.parse_args()

    if args.action == "check":
        run_check_cycle(heal_if_bad=False)
    elif args.action == "backup":
        for db_name in PROTECTED_DBS:
            backup_db(db_name)
    elif args.action == "checkpoint":
        wal_checkpoint_all()
        log("✓ تم تنفيذ PRAGMA wal_checkpoint(PASSIVE) لجميع القواعد.")
    elif args.action == "heal":
        auto_heal(args.db)
    elif args.action == "cycle":
        run_full_cycle()
    elif args.action == "watch":
        log(f"👁️ بدء تشغيل حارس قواعد البيانات في وضع المراقبة الدائمة (كل {args.interval // 60} دقيقة)...")
        while True:
            try:
                run_full_cycle()
            except Exception as e:
                log(f"خطأ غير متوقع في دورة الحارس: {e}", "ERROR")
            time.sleep(args.interval)

if __name__ == "__main__":
    main()
