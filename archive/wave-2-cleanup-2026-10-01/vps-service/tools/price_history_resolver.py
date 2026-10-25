#!/usr/bin/env python3
"""
Price History Path Resolver
=============================
يجد مصدر بيانات الأسعار تلقائياً — بدون نسخ أو تعديل أي قاعدة بيانات.

يبحث بالترتيب:
  1. db/price_history.db (إذا كان به جدول price_history وصفوف)
  2. db/backups/daily/LATEST/price_history.db (أحدث نسخة احتياطية)
  3. db/backups/daily/*/price_history.db (أي نسخة متاحة)

الاستخدام:
  from vps-service.tools.price_history_resolver import find_price_history_db
  db_path = find_price_history_db()  # → '/path/to/price_history.db'

CLI:
  python3 vps-service/tools/price_history_resolver.py           # يطبع المسار
  python3 vps-service/tools/price_history_resolver.py --check   # فحص مفصّل
"""
import sqlite3
import os
import sys
import glob
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DB_DIR = PROJECT_ROOT / 'db'
PRIMARY_PATH = DB_DIR / 'price_history.db'
BACKUP_GLOB = 'db/backups/daily/*/price_history.db'


def _check_price_history_table(db_path):
    """Check if db_path has a valid price_history table with data. Returns (has_table, row_count)."""
    try:
        if not os.path.exists(db_path) or os.path.getsize(db_path) < 1000:
            return (False, 0)
        db = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True, timeout=3)
        tables = [r[0] for r in db.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        if 'price_history' not in tables:
            db.close()
            return (False, 0)
        count = db.execute('SELECT COUNT(*) FROM price_history').fetchone()[0]
        db.close()
        return (True, count)
    except Exception:
        return (False, 0)


def _find_backup_dbs():
    """Find all price_history.db files in backup directories, sorted newest first."""
    pattern = str(PROJECT_ROOT / 'db' / 'backups' / 'daily' / '*' / 'price_history.db')
    paths = glob.glob(pattern)
    # Sort by modification time (newest first)
    paths.sort(key=lambda p: os.path.getmtime(p), reverse=True)
    return paths


def find_price_history_db(min_rows=100):
    """
    Find a price_history.db with actual data.
    
    Returns the absolute path to the first DB that has a price_history table
    with at least `min_rows` rows. Returns None if nothing found.
    
    Search order:
      1. db/price_history.db (primary)
      2. db/backups/daily/LATEST/price_history.db (newest backup)
      3. Any other backup
    
    NEVER copies, moves, or modifies any file — read-only detection.
    """
    # 1. Try primary
    has_table, rows = _check_price_history_table(PRIMARY_PATH)
    if has_table and rows >= min_rows:
        return str(PRIMARY_PATH)

    # 2. Try backups (newest first)
    for backup_path in _find_backup_dbs():
        has_table, rows = _check_price_history_table(backup_path)
        if has_table and rows >= min_rows:
            return backup_path

    return None


def find_price_history_db_info(min_rows=100):
    """Like find_price_history_db but returns detailed info dict."""
    # Check primary
    has_table, rows = _check_price_history_table(PRIMARY_PATH)
    primary_info = {
        'path': str(PRIMARY_PATH),
        'exists': PRIMARY_PATH.exists(),
        'has_table': has_table,
        'rows': rows,
        'size_mb': PRIMARY_PATH.stat().st_size / (1024*1024) if PRIMARY_PATH.exists() else 0,
    }

    # Check backups
    backups = []
    for backup_path in _find_backup_dbs():
        has_table, rows = _check_price_history_table(backup_path)
        backups.append({
            'path': backup_path,
            'has_table': has_table,
            'rows': rows,
            'size_mb': os.path.getsize(backup_path) / (1024*1024),
            'mtime': os.path.getmtime(backup_path),
        })

    # Determine the chosen source
    chosen = None
    if primary_info['has_table'] and primary_info['rows'] >= min_rows:
        chosen = primary_info
    else:
        for b in backups:
            if b['has_table'] and b['rows'] >= min_rows:
                chosen = b
                break

    return {
        'primary': primary_info,
        'backups': backups,
        'chosen': chosen,
        'chosen_path': chosen['path'] if chosen else None,
    }


def main():
    check_mode = '--check' in sys.argv

    print("=" * 60)
    print("  Price History Path Resolver")
    print("=" * 60)

    info = find_price_history_db_info()

    print(f"\n📍 Primary: {info['primary']['path']}")
    if info['primary']['exists']:
        print(f"   Size: {info['primary']['size_mb']:.1f} MB")
        if info['primary']['has_table']:
            print(f"   ✅ price_history table: {info['primary']['rows']:,} rows")
        else:
            print(f"   ⚠️  price_history table: NOT FOUND")
    else:
        print(f"   ❌ File does not exist")

    print(f"\n📦 Backups found: {len(info['backups'])}")
    for b in info['backups'][:5]:  # show newest 5
        status = '✅' if b['has_table'] and b['rows'] > 0 else '⚠️'
        print(f"   {status} {b['path']}")
        print(f"      Size: {b['size_mb']:.1f} MB | Rows: {b['rows']:,}")

    if info['chosen']:
        print(f"\n✅ CHOSEN SOURCE (read-only):")
        print(f"   {info['chosen']['path']}")
        print(f"   Rows: {info['chosen']['rows']:,}")
    else:
        print(f"\n❌ No valid price_history source found!")
        return 1

    if not check_mode:
        # Just print the path for use in scripts
        print(f"\nPATH={info['chosen']['path']}")

    return 0


if __name__ == '__main__':
    sys.exit(main())
