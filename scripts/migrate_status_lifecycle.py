#!/usr/bin/env python3
"""
BRAVO-STATUS-MIGRATION-1
========================
توحيد عمود status في predictions.db ليكون LIFECYCLE فقط (testing/proven/closed).

المشكلة (الـ BLOCKER):
  عمود status كان مستخدم كـ OUTCOME (EXPIRED/TARGET_HIT/STOPPED) في الـ DB،
  بس الكود بيقراه كـ LIFECYCLE (active/PENDING/closed) في أماكن تانية.
  + ألفا عايزة status = 'proven'|'testing'|'closed' للـ UI shell الجديد.
  → تعارض كامل. مستحيل أي UI يشتغل صح.

الـ design (الاختيار أ — توحيد):
  status → lifecycle فقط:
    - 'closed'  : التوقع اتقفل (outcome_date IS NOT NULL)
    - 'proven'  : توقع منشور/نشط (outcome_date IS NULL)
    - 'testing' : توقع جديد تحت الاختبار (هيكتبه المحرك مستقبلاً)

قاعدة الـ migration:
  UPDATE predictions SET status='closed' WHERE outcome_date IS NOT NULL;
  UPDATE predictions SET status='proven' WHERE outcome_date IS NULL;

الأمان:
  1. backup الـ DB قبل أي حاجة (timestamped copy)
  2. transaction كامل (rollback لو أي حاجة غلط)
  3. verify قبل/بعد (counts + consistency)
  4. dry-run mode (--dry-run)

الاستخدام:
  python3 scripts/migrate_status_lifecycle.py --dry-run
  python3 scripts/migrate_status_lifecycle.py
"""
import sqlite3
import shutil
import sys
import argparse
from datetime import datetime
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_PATH = PROJECT_ROOT / "db" / "predictions.db"
BACKUP_DIR = PROJECT_ROOT / "db" / "backups"


def log(msg):
    print(f"  {msg}", flush=True)


def get_status_distribution(con):
    cur = con.cursor()
    rows = cur.execute("SELECT status, COUNT(*) FROM predictions GROUP BY status ORDER BY COUNT(*) DESC").fetchall()
    return {s: c for s, c in rows}


def verify_pre_migration(con):
    log("=== PRE-MIGRATION STATE ===")
    total = con.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    log(f"total predictions: {total}")
    log("\nstatus distribution (BEFORE):")
    for s, c in get_status_distribution(con).items():
        log(f"  {str(s):25s} {c:>6}")
    closed_count = con.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()[0]
    open_count = con.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL").fetchone()[0]
    log(f"\nwill map to 'closed' (outcome_date NOT NULL): {closed_count}")
    log(f"will map to 'proven' (outcome_date NULL):      {open_count}")
    assert closed_count + open_count == total
    return total, closed_count, open_count


def verify_post_migration(con, expected_total, expected_closed, expected_proven):
    log("\n=== POST-MIGRATION STATE ===")
    total = con.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
    log(f"total predictions: {total}")
    dist = get_status_distribution(con)
    log("\nstatus distribution (AFTER):")
    for s, c in dist.items():
        log(f"  {str(s):25s} {c:>6}")
    assert total == expected_total, f"ROW LOSS: {total} != {expected_total}"
    closed = dist.get('closed', 0)
    proven = dist.get('proven', 0)
    assert closed == expected_closed, f"closed MISMATCH: {closed} != {expected_closed}"
    assert proven == expected_proven, f"proven MISMATCH: {proven} != {expected_proven}"
    leftover = {s: c for s, c in dist.items() if s not in ('closed', 'proven', 'testing')}
    if leftover:
        log(f"\n⚠️  LEFTOVER old values: {leftover}")
        return False
    log("\n✅ VERIFICATION PASSED — no row loss, no leftover old values")
    return True


def run_migration(db_path, dry_run=False):
    if not db_path.exists():
        print(f"ERROR: DB not found: {db_path}", file=sys.stderr)
        return 1
    print(f"=" * 60)
    print(f"BRAVO-STATUS-MIGRATION-1")
    print(f"DB: {db_path}")
    print(f"mode: {'DRY-RUN' if dry_run else 'EXECUTE'}")
    print(f"=" * 60)
    if not dry_run:
        BACKUP_DIR.mkdir(parents=True, exist_ok=True)
        ts = datetime.now().strftime("%Y%m%dT%H%M%S")
        backup_path = BACKUP_DIR / f"predictions.db.pre-status-migration.{ts}"
        print(f"\n[1/4] Backup → {backup_path}")
        shutil.copy2(db_path, backup_path)
    else:
        print(f"\n[1/4] Backup (skipped — dry-run)")
    print(f"\n[2/4] Pre-migration verification")
    con = sqlite3.connect(str(db_path))
    expected_total, expected_closed, expected_proven = verify_pre_migration(con)
    if dry_run:
        print(f"\n[3/4] Migration (skipped — dry-run)")
        print(f"\n[4/4] Post-migration verification (skipped — dry-run)")
        print(f"\nExpected: {expected_closed} → 'closed', {expected_proven} → 'proven'")
        con.close()
        return 0
    print(f"\n[3/4] Migration (transactional)")
    try:
        cur = con.cursor()
        cur.execute("BEGIN IMMEDIATE TRANSACTION;")
        r1 = cur.execute("UPDATE predictions SET status='closed' WHERE outcome_date IS NOT NULL")
        log(f"UPDATE → 'closed': {r1.rowcount} rows")
        r2 = cur.execute("UPDATE predictions SET status='proven' WHERE outcome_date IS NULL")
        log(f"UPDATE → 'proven': {r2.rowcount} rows")
        con.commit()
        log("COMMITTED ✓")
    except Exception as e:
        con.rollback()
        log(f"ROLLBACK — error: {e}")
        con.close()
        return 2
    print(f"\n[4/4] Post-migration verification")
    ok = verify_post_migration(con, expected_total, expected_closed, expected_proven)
    con.close()
    return 0 if ok else 3


def main():
    parser = argparse.ArgumentParser(description="Unify predictions.status to lifecycle (closed/proven)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--db", default=str(DB_PATH))
    args = parser.parse_args()
    return run_migration(Path(args.db), dry_run=args.dry_run)


if __name__ == "__main__":
    sys.exit(main())
