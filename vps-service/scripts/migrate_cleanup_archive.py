#!/usr/bin/env python3
"""
Migration: Phase 3 — Cleanup & Archive
=======================================
AUDIT-FIX (2026-10-09): تنظيف الأخبار المتكررة + أرشفة التوقعات القديمة.

PRODUCTION-SAFE: الأرشفة بتنقل البيانات لجداول archive (مش حذف).

Operations:
  1. حذف الأخبار المتكررة (نفس title)
  2. أرشفة التوقعات الأقدم من 6 شهور → predictions_archive
  3. حذف الأخبار بدون title (null)

Usage:
  cd /root/GLMinvestment
  python3 vps-service/scripts/migrate_cleanup_archive.py
  python3 vps-service/scripts/migrate_cleanup_archive.py --dry-run

Author: Main Agent (Z.ai Code) — Audit Deep Inspection
Date: 2026-10-09
"""

import sqlite3
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'

NEWS_DB = DB_DIR / 'news.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] [{level}] {msg}')


def cleanup_news(dry_run=False):
    """حذف الأخبار المتكررة + بدون title."""
    log('━━━ Cleanup news.db ━━━')
    if not NEWS_DB.exists():
        log(f'  ⚠️ {NEWS_DB} غير موجود')
        return

    db = sqlite3.connect(str(NEWS_DB))
    db.execute("PRAGMA journal_mode=WAL")

    # 1. حذف أخبار بدون title
    before = db.execute(
        "SELECT COUNT(*) FROM market_news WHERE title IS NULL OR title = ''"
    ).fetchone()[0]
    if not dry_run:
        db.execute("DELETE FROM market_news WHERE title IS NULL OR title = ''")
    log(f'  حذف أخبار بدون title: {before} rows')

    # 2. حذف التكرارات (نفس title — نحتفظ بالأحدث)
    dups = db.execute("""
        SELECT title, MIN(id) as keep_id, COUNT(*) as c
        FROM market_news
        WHERE title IS NOT NULL AND title != ''
        GROUP BY title
        HAVING c > 1
    """).fetchall()
    total_dups = sum(row[2] - 1 for row in dups)
    if not dry_run:
        for title, keep_id, _ in dups:
            db.execute(
                "DELETE FROM market_news WHERE title = ? AND id != ?",
                (title, keep_id)
            )
    log(f'  حذف أخبار متكررة: {total_dups} rows ({len(dups)} titles)')

    if not dry_run:
        db.commit()
    db.close()


def archive_old_predictions(dry_run=False):
    """أرشفة التوقعات الأقدم من 6 شهور."""
    log('\n━━━ Archive old predictions ━━━')
    if not PREDICTIONS_DB.exists():
        log(f'  ⚠️ {PREDICTIONS_DB} غير موجود')
        return

    db = sqlite3.connect(str(PREDICTIONS_DB))
    db.execute("PRAGMA journal_mode=WAL")

    # التحقق من وجود الأعمدة المطلوبة
    cols = [r[1] for r in db.execute("PRAGMA table_info(predictions)").fetchall()]
    if 'prediction_date' not in cols:
        log('  ⚠️ عمود prediction_date غير موجود — skip')
        db.close()
        return

    # عد التوقعات القديمة
    old_count = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE prediction_date < date('now', '-6 months')
    """).fetchone()[0]
    log(f'  توقعات أقدم من 6 شهور: {old_count}')

    if old_count > 0 and not dry_run:
        # إنشاء جدول الأرشفة
        db.execute("""
            CREATE TABLE IF NOT EXISTS predictions_archive AS
            SELECT * FROM predictions WHERE 1=0
        """)

        # نقل التوقعات القديمة للأرشفة
        db.execute("""
            INSERT INTO predictions_archive
            SELECT * FROM predictions
            WHERE prediction_date < date('now', '-6 months')
        """)

        # حذف من الجدول الأساسي
        db.execute("""
            DELETE FROM predictions
            WHERE prediction_date < date('now', '-6 months')
        """)

        db.commit()
        log(f'  ✅ تم أرشفة {old_count} توقع')

    db.close()


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--dry-run', action='store_true')
    args = parser.parse_args()

    log('═══════════════════════════════════════════════════════════')
    log('  Phase 3: Cleanup & Archive')
    if args.dry_run:
        log('  ⚠️  DRY-RUN MODE')
    log('═══════════════════════════════════════════════════════════\n')

    cleanup_news(args.dry_run)
    archive_old_predictions(args.dry_run)

    log(f'\n{"="*60}')
    log('  ✅ Phase 3 Complete')


if __name__ == '__main__':
    main()
