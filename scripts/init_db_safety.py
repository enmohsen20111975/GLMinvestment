#!/usr/bin/env python3
"""
init_db_safety.py — حماية قواعد البيانات من التلف المستقبلي
================================================================
يطبق على كل DB:
  - journal_mode = WAL (concurrent read/write safety)
  - synchronous = NORMAL (توازن safety/performance)
  - busy_timeout = 30000 (30s انتظار بدل crash)
  - wal_autocheckpoint = 1000 (checkpoint كل 1000 pages)
  - cache_size = -64000 (64MB cache)

FIX (P20-Bug1, Aug 2026): Added file-permission repair.
  - chmod 644 لكل *.db (قابل للقراءة من الجميع، الكتابة للمالك)
  - chmod 644 لكل *.db-wal و *.db-shm (ملفات WAL)
  - chown للمستخدم الحالي (عشان الـ Python backend يقدر يكتب)
  المشكلة: على السيرفر الإنتاجي، الـ DBs كانت بتنزل بصلاحيات root أو readonly
  من عملية الـ unzip، فالـ Python backend كان بيجرب يكتب ويفشل بـ:
    "Error saving cached analysis: attempt to write a readonly database"

شغّله عند بدء Python backend أو يدوياً:
  python3 scripts/init_db_safety.py
"""
import sqlite3
import os
import sys
import stat
import pwd
from pathlib import Path

DB_DIR = Path(__file__).parent.parent / 'db'


def fix_file_permissions(db_path: Path) -> dict:
    """إصلاح صلاحيات ملف الـ DB عشان الـ Python يقدر يكتب فيه.

    - chmod 644 للملف نفسه (rw- r-- r--)
    - chmod 644 لملفات WAL/SHM لو موجودة
    - chown للمستخدم الحالي (لو شغّاله كـ root)
    """
    result = {'chmod': False, 'chown': False, 'wal_files': []}
    try:
        # chmod 644 على الـ DB نفسه
        os.chmod(str(db_path), stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
        result['chmod'] = True
    except Exception as e:
        result['chmod_error'] = str(e)[:60]

    # WAL و SHM files
    for suffix in ['-wal', '-shm']:
        wal_file = Path(str(db_path) + suffix)
        if wal_file.exists():
            try:
                os.chmod(str(wal_file), stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
                result['wal_files'].append(wal_file.name)
            except Exception:
                pass

    # chown للمستخدم الحالي (لو root شغّال السكريبت، يحوّل الملكية للمستخدم الصحيح)
    # بنفذ chown بس لو root (عشان المستخدم العادي ما يقدرش يعمل chown)
    if os.geteuid() == 0:
        # بنشوف مين الـ user اللي شغّال الـ python-backend من env أو بنستخدم www-data
        target_user = os.environ.get('DB_OWNER_USER', 'www-data')
        try:
            uid = pwd.getpwnam(target_user).pw_uid
            gid = pwd.getpwnam(target_user).pw_gid
            os.chown(str(db_path), uid, gid)
            for suffix in ['-wal', '-shm']:
                wal_file = Path(str(db_path) + suffix)
                if wal_file.exists():
                    os.chown(str(wal_file), uid, gid)
            result['chown'] = True
        except Exception as e:
            result['chown_error'] = str(e)[:60]
    else:
        # مش root — نتأكد إن الملف قابل للكتابة للمستخدم الحالي على الأقل
        try:
            if not os.access(str(db_path), os.W_OK):
                os.chmod(str(db_path), stat.S_IRUSR | stat.S_IWUSR | stat.S_IRGRP | stat.S_IROTH)
                result['chmod'] = True
        except Exception:
            pass

    return result


def init_db_safety(db_path):
    """تطبيق إعدادات الحماية على DB + إصلاح الصلاحيات."""
    try:
        # FIX (P20-Bug1): أصلح الصلاحيات الأول، قبل ما نفتح الاتصال
        perm_result = fix_file_permissions(Path(db_path))

        conn = sqlite3.connect(str(db_path), timeout=30)
        conn.execute('PRAGMA journal_mode = WAL')
        conn.execute('PRAGMA synchronous = NORMAL')
        conn.execute('PRAGMA busy_timeout = 30000')
        conn.execute('PRAGMA wal_autocheckpoint = 1000')
        conn.execute('PRAGMA cache_size = -64000')
        conn.execute('PRAGMA foreign_keys = ON')
        # WAL checkpoint لتفادي تراكم الـ WAL file
        try:
            conn.execute('PRAGMA wal_checkpoint(PASSIVE)')
        except:
            pass
        # Verify writable — اختبار الكتابة (THE fix for "readonly database")
        try:
            conn.execute('CREATE TABLE IF NOT EXISTS _safety_check (id INTEGER PRIMARY KEY)')
            conn.execute('DROP TABLE IF EXISTS _safety_check')
            writable = True
        except Exception as we:
            writable = False
            # محاولة إصلاح الصلاحيات تاني
            fix_file_permissions(Path(db_path))
        # Verify integrity
        jm = conn.execute('PRAGMA journal_mode').fetchone()[0]
        ic = conn.execute('PRAGMA integrity_check').fetchone()[0]
        conn.close()
        return {
            'ok': True,
            'journal_mode': jm,
            'integrity': ic[:40],
            'writable': writable,
            'perms': perm_result,
        }
    except Exception as e:
        return {'ok': False, 'error': str(e)[:80]}


def main():
    print('═══ DB Safety Init (P20-Bug1 fix) ═══')
    if not DB_DIR.exists():
        print(f'❌ DB dir not found: {DB_DIR}')
        sys.exit(1)

    db_files = sorted(DB_DIR.glob('*.db'))
    print(f'Found {len(db_files)} DBs')

    ok_count = 0
    writable_count = 0
    for db_path in db_files:
        result = init_db_safety(db_path)
        if result['ok']:
            icon = '✅' if result['integrity'] == 'ok' else '⚠️'
            w_icon = '✍️' if result.get('writable') else '🔒'
            print(f'  {icon} {w_icon} {db_path.name}: journal={result["journal_mode"]}, '
                  f'integrity={result["integrity"][:20]}, writable={result.get("writable")}')
            ok_count += 1
            if result.get('writable'):
                writable_count += 1
        else:
            print(f'  ❌ {db_path.name}: {result["error"]}')

    print(f'\n═══ {ok_count}/{len(db_files)} DBs safe | {writable_count}/{len(db_files)} writable ═══')
    if writable_count < len(db_files):
        print('⚠️  بعض الـ DBs مش قابلة للكتابة! شغّل السكريبت كـ root:')
        print(f'    sudo python3 {__file__}')
        sys.exit(1)


if __name__ == '__main__':
    main()
