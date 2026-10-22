#!/usr/bin/env python3
"""
=============================================================================
📦 Phase 1: archive_legacy_sources.py — أرشفة المصادر القديمة
=============================================================================

القاعدة الذهبية: مافيش أي حاجة تتمسح خالص. كل البيانات تروح للأرشيف.

السكربت ده بيعمل:
  1. ينشئ db/archive/ folder (لو مش موجود)
  2. ينسخ egksco_price_history + historical_data كاملين إلى:
     - db/archive/egksco_price_history_<timestamp>.db
     - db/archive/historical_data_<timestamp>.db
  3. يسجل الأرشفة في data_source_index.db (status = 'archived')
  4. اختبارات صارمة:
     - row count قبل/بعد الأرشفة متطابق
     - schema متطابق
     - sample rows متطابقة
     - الأصلي لسه موجود (مش ممسوح)

Usage:
    python3 scripts/archive_legacy_sources.py
    python3 scripts/archive_legacy_sources.py --dry-run
    python3 scripts/archive_legacy_sources.py --verify  # تحقق من الأرشيف الموجود
=============================================================================
"""
import sqlite3
import argparse
import sys
import shutil
import json
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_DIR = PROJECT_ROOT / 'db'
ARCHIVE_DIR = DB_DIR / 'archive'
INDEX_DB = DB_DIR / 'data_source_index.db'
DATA_ENGINE_DB = DB_DIR / 'data_engine.db'

# المصادر اللي هتتأرشف (priority 3 = legacy)
LEGACY_SOURCES = [
    {
        'db_file': 'data_engine.db',
        'table': 'egksco_price_history',
        'description': 'EGX من egksco scraper — LEGACY (سيتدمج في price_history.db)',
    },
    {
        'db_file': 'data_engine.db',
        'table': 'historical_data',
        'description': 'multi-market historical — LEGACY (سيتدمج في price_history.db)',
    },
]


def get_table_schema(db_path, table):
    """يجيب schema الجدول"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
        return [(c[1], c[2]) for c in cols]
    finally:
        conn.close()


def get_row_count(db_path, table):
    """يجيب row count"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        return conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    finally:
        conn.close()


def get_sample_rows(db_path, table, limit=5):
    """يجيب sample rows للتحقق"""
    conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
    try:
        cols = [c[1] for c in conn.execute(f"PRAGMA table_info({table})").fetchall()]
        cols_str = ', '.join(cols[:8])  # أول 8 أعمدة بس
        rows = conn.execute(f"SELECT {cols_str} FROM {table} LIMIT {limit}").fetchall()
        return {'columns': cols, 'sample': rows}
    except Exception as e:
        return {'error': str(e)}
    finally:
        conn.close()


def archive_source(source):
    """يأرشف مصدر واحد"""
    db_file = source['db_file']
    table = source['table']
    db_path = DB_DIR / db_file

    print(f"\n  📦 archiving {db_file}.{table}...")

    if not db_path.exists():
        print(f"    ❌ {db_file} not found — skipping")
        return {'status': 'skipped', 'reason': 'db not found'}

    # 1. تحقق إن الجدول موجود
    try:
        schema = get_table_schema(db_path, table)
        if not schema:
            print(f"    ⚠️ {table} not found in {db_file} — skipping")
            return {'status': 'skipped', 'reason': 'table not found'}
    except Exception as e:
        print(f"    ❌ schema error: {e}")
        return {'status': 'error', 'reason': str(e)}

    # 2. row count قبل الأرشفة
    row_count_before = get_row_count(db_path, table)
    print(f"    ✓ source: {row_count_before:,} rows | schema: {len(schema)} cols")

    if row_count_before == 0:
        print(f"    ⚠️ table is empty — still archiving schema only")

    # 3. sample rows قبل الأرشفة
    sample_before = get_sample_rows(db_path, table)

    # 4. أنشئ archive DB
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    archive_db_path = ARCHIVE_DIR / f"{table}_{ts}.db"

    # انسخ الـ DB الأصلي مؤقتاً ثم اعمل extract للجدول بس
    # طريقة أبسط: اعمل CREATE TABLE + INSERT SELECT من الـ DB الأصلي
    archive_conn = sqlite3.connect(str(archive_db_path))
    try:
        # اقرا schema كامل من الأصلي (CREATE TABLE statement)
        src_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        create_sql = src_conn.execute(
            "SELECT sql FROM sqlite_master WHERE type='table' AND name=?", (table,)
        ).fetchone()
        src_conn.close()

        if create_sql and create_sql[0]:
            # اعمل CREATE TABLE بنفس الـ schema
            archive_conn.execute(create_sql[0])

            # انسخ البيانات (chunked عشان الجداول الكبيرة)
            src_conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
            cols = [c[1] for c in src_conn.execute(f"PRAGMA table_info({table})").fetchall()]
            cols_str = ', '.join(f'"{c}"' for c in cols)
            placeholders = ', '.join('?' * len(cols))

            batch = []
            BATCH_SIZE = 5000
            for row in src_conn.execute(f"SELECT {cols_str} FROM {table}"):
                batch.append(row)
                if len(batch) >= BATCH_SIZE:
                    archive_conn.executemany(
                        f"INSERT INTO {table} VALUES ({placeholders})", batch
                    )
                    batch = []
            if batch:
                archive_conn.executemany(
                    f"INSERT INTO {table} VALUES ({placeholders})", batch
                )
            src_conn.close()

            archive_conn.commit()
        else:
            print(f"    ⚠️ no CREATE TABLE sql found — archiving schema only")

    finally:
        archive_conn.close()

    # 5. تحقق من الأرشيف
    row_count_after = get_row_count(archive_db_path, table)
    schema_after = get_table_schema(archive_db_path, table)
    sample_after = get_sample_rows(archive_db_path, table)

    checks = []

    # Check 1: row count متطابق
    if row_count_before == row_count_after:
        checks.append(('row_count_match', 'PASS', f'{row_count_before:,} == {row_count_after:,}'))
        print(f"    ✅ Check 1: row count match ({row_count_before:,})")
    else:
        checks.append(('row_count_match', 'FAIL', f'{row_count_before} != {row_count_after}'))
        print(f"    ❌ Check 1: row count mismatch ({row_count_before} != {row_count_after})")

    # Check 2: schema متطابق
    if len(schema) == len(schema_after):
        checks.append(('schema_match', 'PASS', f'{len(schema)} cols'))
        print(f"    ✅ Check 2: schema match ({len(schema)} cols)")
    else:
        checks.append(('schema_match', 'FAIL', f'{len(schema)} != {len(schema_after)}'))
        print(f"    ❌ Check 2: schema mismatch")

    # Check 3: sample rows متطابقة
    if (not isinstance(sample_before, dict) or 'error' not in sample_before) and \
       (not isinstance(sample_after, dict) or 'error' not in sample_after):
        if sample_before.get('sample') == sample_after.get('sample'):
            checks.append(('sample_match', 'PASS', f'{len(sample_before.get("sample", []))} rows'))
            print(f"    ✅ Check 3: sample rows match")
        else:
            checks.append(('sample_match', 'FAIL', 'samples differ'))
            print(f"    ❌ Check 3: sample rows differ")

    # Check 4: الأصلي لسه موجود (مش ممسوح)
    if db_path.exists():
        original_still_there = get_row_count(db_path, table)
        if original_still_there == row_count_before:
            checks.append(('original_intact', 'PASS', f'original still has {original_still_there:,} rows'))
            print(f"    ✅ Check 4: original intact ({original_still_there:,} rows)")
        else:
            checks.append(('original_intact', 'FAIL', f'original changed: {original_still_there}'))
            print(f"    ❌ Check 4: original changed!")
    else:
        checks.append(('original_intact', 'FAIL', 'original missing!'))
        print(f"    ❌ Check 4: original missing!")

    return {
        'status': 'archived',
        'archive_path': str(archive_db_path),
        'row_count': row_count_after,
        'checks': checks,
    }


def update_index_status(source, archive_result):
    """حدث status في data_source_index.db إلى 'archived'"""
    if not INDEX_DB.exists():
        print(f"    ⚠️ {INDEX_DB} not found — skipping index update")
        return

    conn = sqlite3.connect(str(INDEX_DB))
    try:
        conn.execute("""
            UPDATE source_inventory
            SET status = 'archived',
                description = ?
            WHERE db_file = ? AND table_name = ?
        """, (
            f"{source['description']} | ARCHIVED to {archive_result['archive_path']} at {datetime.now().isoformat()[:19]}",
            source['db_file'], source['table']
        ))

        # سجل في verification_log
        for check_name, check_result, details in archive_result.get('checks', []):
            conn.execute("""
                INSERT INTO verification_log (check_name, check_result, details, timestamp)
                VALUES (?, ?, ?, ?)
            """, (
                f"archive_{source['table']}_{check_name}",
                check_result, details, datetime.now().isoformat()
            ))

        conn.commit()
    finally:
        conn.close()


def archive_all(dry_run=False):
    """يأرشف كل المصادر القديمة"""
    print(f"[{datetime.now().isoformat()[:19]}] 📦 Phase 1: archiving legacy sources...")

    if dry_run:
        print(f"  [DRY RUN] no actual changes will be made")

    # أنشئ archive folder
    if not dry_run:
        ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
        print(f"  ✓ archive dir: {ARCHIVE_DIR}")

    results = []
    all_passed = True

    for source in LEGACY_SOURCES:
        if dry_run:
            db_path = DB_DIR / source['db_file']
            if db_path.exists():
                try:
                    count = get_row_count(db_path, source['table'])
                    print(f"\n  [DRY RUN] would archive {source['db_file']}.{source['table']}: {count:,} rows")
                except:
                    print(f"\n  [DRY RUN] {source['table']} not found — would skip")
            else:
                print(f"\n  [DRY RUN] {source['db_file']} not found — would skip")
            results.append({'source': source['table'], 'status': 'dry_run'})
            continue

        result = archive_source(source)
        results.append({'source': source['table'], **result})

        if result['status'] == 'archived':
            # تحقق إن كل الـ checks passed
            failed_checks = [c for c in result.get('checks', []) if c[1] == 'FAIL']
            if failed_checks:
                all_passed = False
                print(f"    ⚠️ {len(failed_checks)} checks failed — archive may be incomplete")
            else:
                print(f"    ✅ all checks passed")
                # حدث الـ index
                update_index_status(source, result)
        else:
            all_passed = False

    # ملخص
    print(f"\n  📊 Summary:")
    for r in results:
        if r.get('status') == 'archived':
            checks = r.get('checks', [])
            passed = sum(1 for c in checks if c[1] == 'PASS')
            failed = sum(1 for c in checks if c[1] == 'FAIL')
            print(f"    {r['source']:30s}: archived ({r.get('row_count', 0):,} rows) | {passed} passed, {failed} failed")
        else:
            print(f"    {r['source']:30s}: {r['status']}")

    print(f"\n  📁 Archive folder: {ARCHIVE_DIR}")
    if ARCHIVE_DIR.exists():
        for f in sorted(ARCHIVE_DIR.glob('*.db')):
            size_mb = f.stat().st_size / (1024 * 1024)
            print(f"    {f.name}: {size_mb:.2f} MB")

    if all_passed:
        print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 1 complete — all checks passed")
    else:
        print(f"\n[{datetime.now().isoformat()[:19]}] ⚠️ Phase 1 complete with warnings")

    return 0 if all_passed else 1


def verify_archive():
    """يتحقق من الأرشيف الموجود"""
    print(f"📋 Verifying archives in {ARCHIVE_DIR}...\n")

    if not ARCHIVE_DIR.exists():
        print(f"❌ {ARCHIVE_DIR} not found")
        return 1

    archives = list(ARCHIVE_DIR.glob('*.db'))
    if not archives:
        print(f"❌ no archive files found")
        return 1

    for archive_db in sorted(archives):
        print(f"  📦 {archive_db.name} ({archive_db.stat().st_size / (1024*1024):.2f} MB)")
        conn = sqlite3.connect(f"file:{archive_db}?mode=ro", uri=True)
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall() if not r[0].startswith('sqlite_')]
        for t in tables:
            cnt = conn.execute(f"SELECT COUNT(*) FROM {t}").fetchone()[0]
            print(f"    {t}: {cnt:,} rows")
        conn.close()

    # تحقق من الـ index
    if INDEX_DB.exists():
        print(f"\n  📋 Source Index status:")
        conn = sqlite3.connect(f"file:{INDEX_DB}?mode=ro", uri=True)
        for r in conn.execute(
            "SELECT db_file, table_name, status, row_count FROM source_inventory ORDER BY status, row_count DESC"
        ).fetchall():
            print(f"    {r[0]:20s} {r[1]:25s} status={r[2]:10s} rows={r[3]:,}")
        conn.close()

    return 0


def main():
    parser = argparse.ArgumentParser(description='Archive legacy price sources (Phase 1)')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط بدون تعديل')
    parser.add_argument('--verify', action='store_true', help='تحقق من الأرشيف الموجود')
    args = parser.parse_args()

    if args.verify:
        return verify_archive()
    return archive_all(dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
