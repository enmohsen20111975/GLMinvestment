#!/usr/bin/env python3
"""
Smart DB Integrity Guard — حارس الداتابيز الذكي
================================================
سكريبت يومي بيحمي الداتابيز من الفقدان أو التلف. بيشتغل كالتالي:

  1. WAL checkpoint لكل داتابيز (لدمج الـ WAL في الـ main DB).
  2. بيشيك على حجم كل داتابيز دلوقتي vs آخر backup سليم.
  3. الذكاء: لو حجم أي داتابيز **نقص بنسبة 20% أو أكتر** عن آخر backup:
       - بيرفض يعمل backup جديد للملف ده.
       - بيعمل Restore فوري من آخر backup سليم.
       - بينزل إنذار في اللوج: "تحذير: حجم الداتابيز نقص، تم عمل Restore تلقائي".
  4. لو الحجم سليم (نقص < 20% أو مفيش backup سابق)، بيعمل backup جديد.
  5. Rotation: بيفضل آخر 7 backups يومية لكل داتابيز.

السبب: لو حد (مبرمج أو كرون أو crash) مسح داتا بالغلط، الـ guard هيرجّعها
تلقائياً قبل ما الـ backup الجديد ي overlte على الـ backup السليم.

Usage:
    python3 vps-service/scripts/smart_db_backup.py
    # Or via cron:
    # 0 5 * * * cd /root/GLMinvestment && python3 vps-service/scripts/smart_db_backup.py

Exit codes:
    0 = كل حاجة سليمة
    1 = فيه تحذيرات بس الـ restore اشتغل
    2 = خطأ حرج (مش قادر يكمل)
"""

import sqlite3
import os
import sys
import shutil
import json
from pathlib import Path
from datetime import datetime
from typing import Dict, List, Tuple, Optional

# ─────────────────────────────────────────────────────────────────────────────
# Configuration
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
DB_DIR = PROJECT_ROOT / 'db'
BACKUP_DIR = DB_DIR / 'backups' / 'smart'
LOG_FILE = DB_DIR / 'backups' / 'smart_guard.log'

# الـ DBs المهمة اللي لازم نراقبها (الـ 3 الكنوز + الـ auth + الـ predictions)
WATCH_DBS = [
    'stocks.db',
    'data_engine.db',
    'price_history.db',
    'predictions.db',
    'auth.db',
    'intraday.db',
    'crypto.db',
]

# عتبة الإنذار: لو حجم الـ DB الحالي < (آخر backup × (1 - SHRINK_THRESHOLD))
# → ارفض الـ backup الجديد واعمل restore.
SHRINK_THRESHOLD = 0.20  # 20%

# عتبة النمو: لو الـ DB كبر 5x فجأة → تحذير بس (مش restore — يمكن بيانات حقيقية)
GROWTH_WARN_THRESHOLD = 5.0

# Rotation: كم backup نحتفظ به لكل DB
KEEP_BACKUPS = 7


def log(msg: str, level: str = 'INFO') -> None:
    """Write to log file and print with level."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{timestamp}] [{level}] {msg}'
    print(line)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def human_size(bytes_val: int) -> str:
    """Format bytes to human-readable."""
    if bytes_val < 1024:
        return f'{bytes_val} B'
    elif bytes_val < 1024 * 1024:
        return f'{bytes_val / 1024:.1f} KB'
    elif bytes_val < 1024 * 1024 * 1024:
        return f'{bytes_val / (1024 * 1024):.1f} MB'
    else:
        return f'{bytes_val / (1024 * 1024 * 1024):.2f} GB'


def wal_checkpoint(db_path: Path) -> bool:
    """Run WAL checkpoint to merge WAL into main DB."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=10)
        conn.execute('PRAGMA wal_checkpoint(TRUNCATE);')
        conn.close()
        return True
    except Exception as e:
        log(f'WAL checkpoint failed for {db_path.name}: {e}', 'WARN')
        return False


def run_integrity_check(db_path: Path) -> bool:
    """Run PRAGMA integrity_check on the DB."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=10)
        cur = conn.cursor()
        result = cur.execute('PRAGMA integrity_check;').fetchone()
        conn.close()
        return result and result[0] == 'ok'
    except Exception as e:
        log(f'integrity_check failed for {db_path.name}: {e}', 'WARN')
        return False


def get_db_size(db_path: Path) -> int:
    """Get current DB file size in bytes."""
    try:
        return db_path.stat().st_size
    except Exception:
        return 0


def find_last_good_backup(db_name: str) -> Optional[Path]:
    """Find the most recent valid backup for a DB.

    Looks for files matching: <db_name>.<timestamp>.db
    Returns the most recent one that passes integrity_check, or None.
    """
    stem = db_name.replace('.db', '')
    pattern = f'{stem}.*.db'
    candidates = sorted(BACKUP_DIR.glob(pattern), reverse=True)
    for backup in candidates:
        # Validate it's a real SQLite file (magic header "SQLite format 3")
        try:
            with open(backup, 'rb') as f:
                header = f.read(16)
            if not header.startswith(b'SQLite format 3'):
                log(f'Skipping corrupt backup (bad header): {backup.name}', 'WARN')
                continue
        except Exception:
            continue
        # Validate integrity
        if run_integrity_check(backup):
            return backup
        else:
            log(f'Skipping corrupt backup (integrity fail): {backup.name}', 'WARN')
    return None


def restore_from_backup(db_path: Path, backup_path: Path) -> bool:
    """Restore a DB from a backup file. Returns True on success."""
    try:
        # Delete the current (shrunken) DB + its WAL/SHM sidecars
        for suffix in ['', '-wal', '-shm']:
            sidecar = Path(str(db_path) + suffix)
            if sidecar.exists():
                sidecar.unlink()
        # Copy backup → current
        shutil.copy2(str(backup_path), str(db_path))
        log(
            f'RESTORED {db_path.name} from {backup_path.name} '
            f'({human_size(backup_path.stat().st_size)})',
            'RESTORE'
        )
        return True
    except Exception as e:
        log(f'RESTORE FAILED for {db_path.name}: {e}', 'ERROR')
        return False


def create_backup(db_path: Path) -> Optional[Path]:
    """Create a timestamped backup of a DB. Returns the backup path or None."""
    if not db_path.exists():
        return None
    timestamp = datetime.now().strftime('%Y%m%d_%H%M%S')
    stem = db_path.name.replace('.db', '')
    backup_path = BACKUP_DIR / f'{stem}.{timestamp}.db'
    try:
        # Use SQLite backup API for a consistent snapshot
        source = sqlite3.connect(str(db_path), timeout=10)
        dest = sqlite3.connect(str(backup_path), timeout=10)
        with dest:
            source.backup(dest)
        dest.close()
        source.close()
        return backup_path
    except Exception as e:
        log(f'Backup creation failed for {db_path.name}: {e}', 'ERROR')
        # Fallback: file copy (less safe, but better than nothing)
        try:
            shutil.copy2(str(db_path), str(backup_path))
            return backup_path
        except Exception as e2:
            log(f'File-copy fallback also failed for {db_path.name}: {e2}', 'ERROR')
            return None


def rotate_backups(db_name: str) -> None:
    """Keep only the most recent KEEP_BACKUPS backups for a DB."""
    stem = db_name.replace('.db', '')
    pattern = f'{stem}.*.db'
    backups = sorted(BACKUP_DIR.glob(pattern), reverse=True)
    for old in backups[KEEP_BACKUPS:]:
        try:
            old.unlink()
            log(f'Rotated out old backup: {old.name}', 'DEBUG')
        except Exception:
            pass


def get_table_row_counts(db_path: Path) -> Dict[str, int]:
    """Get row counts for all tables in a DB. Used to detect data loss
    even when file size stays the same (SQLite page allocation)."""
    counts = {}
    try:
        conn = sqlite3.connect(str(db_path), timeout=10)
        cur = conn.cursor()
        tables = cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'"
        ).fetchall()
        for (table_name,) in tables:
            try:
                count = cur.execute(f'SELECT COUNT(*) FROM "{table_name}"').fetchone()[0]
                counts[table_name] = count
            except Exception:
                pass
        conn.close()
    except Exception as e:
        log(f'get_table_row_counts failed for {db_path.name}: {e}', 'WARN')
    return counts


def get_backup_row_counts(backup_path: Path) -> Dict[str, int]:
    """Get row counts from a backup file."""
    return get_table_row_counts(backup_path)


def detect_row_loss(current_counts: Dict[str, int], backup_counts: Dict[str, int]) -> Tuple[bool, str]:
    """Detect if any table lost ≥ 20% of its rows compared to the last backup.

    Returns (loss_detected, reason).
    """
    if not backup_counts:
        return False, ''
    for table, backup_count in backup_counts.items():
        current_count = current_counts.get(table, 0)
        if backup_count == 0:
            continue
        loss_pct = (backup_count - current_count) / backup_count
        if loss_pct >= SHRINK_THRESHOLD:
            reason = (
                f'Table "{table}" lost {loss_pct*100:.1f}% of rows '
                f'({backup_count} → {current_count})'
            )
            return True, reason
    return False, ''


def process_db(db_name: str) -> Dict:
    """Process a single DB: check, backup or restore. Returns a status dict."""
    db_path = DB_DIR / db_name
    status = {
        'db': db_name,
        'exists': db_path.exists(),
        'current_size': 0,
        'last_backup_size': 0,
        'action': 'NONE',
        'shrink_pct': 0.0,
        'restored': False,
        'backed_up': False,
        'integrity_ok': False,
    }

    if not status['exists']:
        log(f'DB not found: {db_name} — skipping', 'WARN')
        return status

    # 1. WAL checkpoint first (so size reflects all committed data)
    wal_checkpoint(db_path)

    # 2. Integrity check
    status['integrity_ok'] = run_integrity_check(db_path)
    if not status['integrity_ok']:
        log(f'integrity_check FAILED for {db_name} — will try restore', 'ERROR')

    # 3. Get current size
    status['current_size'] = get_db_size(db_path)

    # 4. Find last good backup
    last_backup = find_last_good_backup(db_name)
    if last_backup:
        status['last_backup_size'] = last_backup.stat().st_size
        # Calculate shrink percentage
        if status['last_backup_size'] > 0:
            status['shrink_pct'] = (
                (status['last_backup_size'] - status['current_size'])
                / status['last_backup_size']
            )

        # P27-ROW-LOSS: فحص عدد الصفوف كمان (مش بس file size).
        # السبب: SQLite بياخد page size ثابتة، فممكن الـ file size يفضل ثابت
        # بعد مسح صفوف كتير. فحص الـ row counts بيكتشف الفقدان الحقيقي.
        current_counts = get_table_row_counts(db_path)
        backup_counts = get_backup_row_counts(last_backup)
        row_loss_detected, row_loss_reason = detect_row_loss(current_counts, backup_counts)

        # 5. SMART GUARD: If DB shrank by ≥ SHRINK_THRESHOLD OR integrity failed OR row loss
        if (
            status['shrink_pct'] >= SHRINK_THRESHOLD
            or not status['integrity_ok']
            or row_loss_detected
        ):
            alert_reasons = []
            if status['shrink_pct'] >= SHRINK_THRESHOLD:
                alert_reasons.append(
                    f'file_size_shrink={status["shrink_pct"]*100:.1f}%'
                )
            if not status['integrity_ok']:
                alert_reasons.append('integrity_check_failed')
            if row_loss_detected:
                alert_reasons.append(f'row_loss: {row_loss_reason}')
            alert_msg = '; '.join(alert_reasons)

            log(
                f'🚨 SHRINK DETECTED: {db_name} — '
                f'current={human_size(status["current_size"])} '
                f'last_backup={human_size(status["last_backup_size"])} '
                f'shrink={status["shrink_pct"]*100:.1f}% '
                f'(threshold={SHRINK_THRESHOLD*100:.0f}%) | {alert_msg}',
                'ALERT'
            )
            log(
                f'⚠️ تحذير: الداتابيز {db_name} فيه فقدان بيانات ({alert_msg})، '
                f'تم عمل Restore تلقائي من آخر backup سليم',
                'ALERT'
            )
            # RESTORE immediately — do NOT overwrite the good backup
            if restore_from_backup(db_path, last_backup):
                status['restored'] = True
                status['action'] = 'RESTORED'
                # Re-checkpoint after restore
                wal_checkpoint(db_path)
                status['current_size'] = get_db_size(db_path)
            else:
                status['action'] = 'RESTORE_FAILED'
            return status

        # 6. Growth warning (informational only)
        if status['last_backup_size'] > 0:
            growth_ratio = status['current_size'] / status['last_backup_size']
            if growth_ratio >= GROWTH_WARN_THRESHOLD:
                log(
                    f'⚠️ GROWTH WARNING: {db_name} grew {growth_ratio:.1f}x '
                    f'({human_size(status["last_backup_size"])} → {human_size(status["current_size"])})',
                    'WARN'
                )
    else:
        log(f'No previous backup for {db_name} — first run, will create one', 'INFO')

    # 7. Create new backup (only if DB is healthy)
    new_backup = create_backup(db_path)
    if new_backup:
        status['backed_up'] = True
        status['action'] = 'BACKED_UP'
        log(
            f'✅ Backed up {db_name} → {new_backup.name} '
            f'({human_size(new_backup.stat().st_size)})',
            'INFO'
        )
        # 8. Rotate old backups
        rotate_backups(db_name)
    else:
        status['action'] = 'BACKUP_FAILED'

    return status


def write_status_report(results: List[Dict]) -> None:
    """Write a JSON status report for monitoring."""
    report = {
        'timestamp': datetime.now().isoformat(),
        'shrink_threshold_pct': SHRINK_THRESHOLD * 100,
        'total_dbs': len(results),
        'restored': sum(1 for r in results if r['restored']),
        'backed_up': sum(1 for r in results if r['backed_up']),
        'failed': sum(1 for r in results if 'FAILED' in r['action']),
        'dbs': results,
    }
    report_path = BACKUP_DIR / 'last_run_report.json'
    try:
        with open(report_path, 'w', encoding='utf-8') as f:
            json.dump(report, f, ensure_ascii=False, indent=2)
    except Exception as e:
        log(f'Failed to write status report: {e}', 'WARN')


def main() -> int:
    """Main entry point. Returns exit code."""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    log('=' * 70, 'INFO')
    log('Smart DB Integrity Guard — starting run', 'INFO')
    log(f'PROJECT_ROOT={PROJECT_ROOT}', 'INFO')
    log(f'DB_DIR={DB_DIR}', 'INFO')
    log(f'BACKUP_DIR={BACKUP_DIR}', 'INFO')
    log(f'SHRINK_THRESHOLD={SHRINK_THRESHOLD*100:.0f}%', 'INFO')
    log('=' * 70, 'INFO')

    if not DB_DIR.exists():
        log(f'DB directory does not exist: {DB_DIR}', 'ERROR')
        return 2

    results: List[Dict] = []
    any_restore = False
    any_failure = False

    for db_name in WATCH_DBS:
        try:
            result = process_db(db_name)
            results.append(result)
            if result['restored']:
                any_restore = True
            if 'FAILED' in result['action']:
                any_failure = True
        except Exception as e:
            log(f'UNEXPECTED ERROR processing {db_name}: {e}', 'ERROR')
            any_failure = True

    # Summary
    total = len(results)
    restored = sum(1 for r in results if r['restored'])
    backed_up = sum(1 for r in results if r['backed_up'])
    failed = sum(1 for r in results if 'FAILED' in r['action'])

    log('=' * 70, 'INFO')
    log(
        f'Summary: total={total} backed_up={backed_up} '
        f'restored={restored} failed={failed}',
        'INFO'
    )

    write_status_report(results)

    if any_failure:
        log('Run completed with failures (exit 2)', 'ERROR')
        return 2
    elif any_restore:
        log('Run completed with automatic restores (exit 1)', 'WARN')
        return 1
    else:
        log('Run completed successfully (exit 0)', 'INFO')
        return 0


if __name__ == '__main__':
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        log('Interrupted by user', 'WARN')
        sys.exit(130)
    except Exception as e:
        log(f'Fatal error: {e}', 'ERROR')
        sys.exit(2)
