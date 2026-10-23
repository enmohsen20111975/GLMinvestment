#!/usr/bin/env python3
"""
Daily Database Backup Script
=============================
Runs via cron to:
1. WAL checkpoint all databases
2. Run PRAGMA integrity_check on each
3. Create timestamped backups in db/backups/daily/
4. Rotate: keep last 7 daily, 4 weekly (Sunday), 3 monthly (1st of month)
5. Logs everything to db/backups/backup.log

Usage:
    python3 vps-service/scripts/daily_backup.py
    # Or via cron:
    # 0 5 * * * cd /root/GLMinvestment && python3 vps-service/scripts/daily_backup.py

Setup:
    chmod +x vps-service/scripts/daily_backup.py
    crontab -e  # add the line above
"""

import sqlite3
import os
import sys
import shutil
import json
from pathlib import Path
from datetime import datetime, timedelta
from typing import Dict, List, Tuple

# Project root
PROJECT_ROOT = Path(__file__).parent.parent.parent.resolve()
DB_DIR = PROJECT_ROOT / 'db'
BACKUP_DIR = DB_DIR / 'backups' / 'daily'
LOG_FILE = DB_DIR / 'backups' / 'backup.log'

# Databases to back up (all .db files in db/ except those in exclusions)
EXCLUDE_DBS = {
    '_corrupt_backup_20260710_195845',  # corrupt backup dir
}

# Rotation settings
KEEP_DAILY = 7
KEEP_WEEKLY = 4
KEEP_MONTHLY = 3


def log(msg: str) -> None:
    """Write to log file and print."""
    timestamp = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    line = f'[{timestamp}] {msg}'
    print(line)
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    with open(LOG_FILE, 'a', encoding='utf-8') as f:
        f.write(line + '\n')


def human_size(bytes_val: int) -> str:
    """Format bytes to human-readable."""
    if bytes_val < 1024:
        return f'{bytes_val} B'
    kb = bytes_val / 1024
    if kb < 1024:
        return f'{kb:.1f} KB'
    mb = kb / 1024
    if mb < 1024:
        return f'{mb:.2f} MB'
    return f'{mb / 1024:.2f} GB'


def get_all_databases() -> List[str]:
    """Get all .db files in db/ directory."""
    dbs = []
    for f in sorted(DB_DIR.iterdir()):
        if f.is_file() and f.suffix == '.db' and not f.name.endswith('-wal') and not f.name.endswith('-shm'):
            name_lower = f.name.lower()
            # Skip backup, corrupt, recovered, original, temp, test files to avoid false alarms
            if any(x in name_lower for x in ['backup', 'corrupt', 'recover', 'original', 'temp', 'tmp', 'test']):
                continue
            if f.name not in EXCLUDE_DBS:
                dbs.append(f.name)
    return dbs


def wal_checkpoint(db_path: str) -> Tuple[bool, str]:
    """Run WAL checkpoint on a database."""
    try:
        # Phase 7.1: migrated to db_manager (writable=True)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(db_path, writable=True)
        conn.execute('PRAGMA journal_mode=WAL')
        result = conn.execute('PRAGMA wal_checkpoint(TRUNCATE)').fetchone()
        conn.close()
        busy, log_frames, checkpointed = result
        if busy == 0 and checkpointed >= 0:
            return True, f'checkpointed={checkpointed} log={log_frames}'
        return False, f'busy={busy} log={log_frames} checkpointed={checkpointed}'
    except Exception as e:
        return False, str(e)


def integrity_check(db_path: str) -> Tuple[bool, str]:
    """Run integrity_check on a database."""
    try:
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        conn = db_manager.get_connection(db_path, writable=False)
        result = conn.execute('PRAGMA integrity_check').fetchone()
        conn.close()
        if result[0] == 'ok':
            return True, 'ok'
        return False, result[0]
    except Exception as e:
        return False, str(e)


def run_backup() -> Dict:
    """Main backup routine."""
    results = {
        'timestamp': datetime.now().isoformat(),
        'date': datetime.now().strftime('%Y-%m-%d'),
        'day_of_week': datetime.now().strftime('%A'),
        'dbs': [],
        'ok': 0,
        'corrupt': 0,
        'failed': 0,
        'total_size_bytes': 0,
    }

    log('========== Daily Backup Started ==========')
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)

    date_str = datetime.now().strftime('%Y%m%d_%H%M%S')
    databases = get_all_databases()

    log(f'Found {len(databases)} databases to backup')

    # Step 1: WAL checkpoint all
    log('--- WAL Checkpoint ---')
    for db_name in databases:
        db_path = DB_DIR / db_name
        ok, msg = wal_checkpoint(str(db_path))
        log(f'  WAL {db_name}: {"OK" if ok else "FAIL"} - {msg}')

    # Step 2: Integrity check all
    log('--- Integrity Check ---')
    integrity_results = {}
    for db_name in databases:
        db_path = DB_DIR / db_name
        ok, msg = integrity_check(str(db_path))
        integrity_results[db_name] = (ok, msg)
        icon = '✓' if ok else '✗'
        log(f'  {icon} {db_name}: {msg}')

    # Step 3: Copy to backup directory
    log('--- Copying to Backup ---')
    backup_date_dir = BACKUP_DIR / date_str
    backup_date_dir.mkdir(parents=True, exist_ok=True)

    for db_name in databases:
        src = DB_DIR / db_name
        dst = backup_date_dir / db_name

        try:
            shutil.copy2(str(src), str(dst))

            # Copy WAL/SHM sidecars
            for ext in ['-wal', '-shm']:
                src_sidecar = Path(str(src) + ext)
                if src_sidecar.exists():
                    shutil.copy2(str(src_sidecar), str(dst) + ext)

            db_size = dst.stat().st_size
            results['total_size_bytes'] += db_size

            is_ok = integrity_results.get(db_name, (False, 'unknown'))[0]
            db_result = {
                'name': db_name,
                'size': db_size,
                'size_human': human_size(db_size),
                'integrity': 'ok' if is_ok else 'corrupt',
                'integrity_msg': integrity_results.get(db_name, ('', 'unknown'))[1],
            }

            if is_ok:
                results['ok'] += 1
            else:
                results['corrupt'] += 1
                db_result['corrupt'] = True

            results['dbs'].append(db_result)
            log(f'  ✓ {db_name} ({human_size(db_size)})')

        except Exception as e:
            results['failed'] += 1
            results['dbs'].append({
                'name': db_name,
                'size': 0,
                'size_human': '0 B',
                'integrity': 'failed',
                'integrity_msg': str(e),
            })
            log(f'  ✗ {db_name}: FAILED - {e}')

    # Step 4: Write summary JSON
    summary_file = backup_date_dir / 'backup_summary.json'
    with open(summary_file, 'w', encoding='utf-8') as f:
        json.dump(results, f, ensure_ascii=False, indent=2)

    # Step 5: Rotate old backups
    log('--- Rotation ---')
    rotate_backups()

    # Step 6: Clean up old log entries (keep last 90 days)
    rotate_logs()

    log(f'========== Backup Complete: {results["ok"]} OK, {results["corrupt"]} corrupt, {results["failed"]} failed ==========')
    log(f'Total size: {human_size(results["total_size_bytes"])}')
    return results


def rotate_backups() -> None:
    """Rotate old backups: keep last 7 daily, 4 weekly, 3 monthly."""
    if not BACKUP_DIR.exists():
        return

    # List all backup directories sorted by date
    dirs = sorted(
        [d for d in BACKUP_DIR.iterdir() if d.is_dir() and d.name[:8].isdigit()],
        key=lambda d: d.name,
    )

    if len(dirs) <= KEEP_DAILY:
        log(f'  {len(dirs)} backups — no rotation needed')
        return

    to_keep = set()
    now = datetime.now()

    for d in dirs:
        try:
            date_obj = datetime.strptime(d.name[:8], '%Y%m%d')
        except ValueError:
            continue

        # Keep last N daily
        if (now - date_obj).days < KEEP_DAILY:
            to_keep.add(d.name)
            continue

        # Keep weekly (Sunday = 6)
        if date_obj.weekday() == 6:  # Sunday
            weeks_ago = (now - date_obj).days // 7
            if weeks_ago < KEEP_WEEKLY * 7:
                to_keep.add(d.name)
                continue

        # Keep monthly (1st of month)
        if date_obj.day == 1:
            months_ago = (now.year - date_obj.year) * 12 + (now.month - date_obj.month)
            if months_ago < KEEP_MONTHLY:
                to_keep.add(d.name)
                continue

    # Delete what's not kept
    deleted = 0
    for d in dirs:
        if d.name not in to_keep:
            try:
                shutil.rmtree(str(d))
                deleted += 1
            except Exception as e:
                log(f'  Failed to delete {d.name}: {e}')

    if deleted > 0:
        log(f'  Rotated: deleted {deleted} old backups, kept {len(to_keep)}')
    else:
        log(f'  {len(dirs)} backups — no rotation needed')


def rotate_logs() -> None:
    """Keep only last 90 days of log entries."""
    if not LOG_FILE.exists():
        return

    cutoff = datetime.now() - timedelta(days=90)
    lines = []
    with open(LOG_FILE, 'r', encoding='utf-8') as f:
        lines = f.readlines()

    kept = []
    for line in lines:
        try:
            ts_str = line[1:20]  # Extract timestamp from [YYYY-MM-DD HH:MM:SS]
            ts = datetime.strptime(ts_str, '%Y-%m-%d %H:%M:%S')
            if ts >= cutoff:
                kept.append(line)
        except (ValueError, IndexError):
            kept.append(line)  # Keep non-timestamped lines

    with open(LOG_FILE, 'w', encoding='utf-8') as f:
        f.writelines(kept)


if __name__ == '__main__':
    try:
        result = run_backup()
        sys.exit(0 if result['corrupt'] == 0 and result['failed'] == 0 else 1)
    except Exception as e:
        log(f'FATAL ERROR: {e}')
        import traceback
        traceback.print_exc()
        sys.exit(2)