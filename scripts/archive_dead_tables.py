#!/usr/bin/env python3
"""
archive_dead_tables.py — أرشفة الجداول وقواعد البيانات المهجورة
=================================================================================
Task BRAVO-PURGE-2 (Owner Directive 2026-10-14)

الهدف: حصر وأرشفة القواعد المهجورة + تنظيف الجداول القديمة الموازية لـ predictions
لضمان أن جدول predictions الكنسي هو المصدر الوحيد المطلق.

العمليات:
  1. حصر DBs المهجورة (crypto.db, analytics.db, community.db, إلخ) + أرشفتها
  2. حصر الجداول الموازية لـ predictions في stocks.db (aiPrediction, prediction_logs,
     ExpertRecommendation, tuned_predictions_summary, real_evaluated_predictions, إلخ)
  3. نقل الجداول الميتة لـ schema ميتة (rename to _archived_<name>) بدل حذفها
  4. تقرير شامل بالجداول المؤرشفة + أحجامها

السكريبت idempotent (آمن للتشغيل المتكرر) + NO destructive deletes (rename only).

Usage:
    python3 scripts/archive_dead_tables.py                # تنفيذ + تقرير
    python3 scripts/archive_dead_tables.py --dry-run      # تقرير فقط
    python3 scripts/archive_dead_tables.py --json         # JSON output
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"
STOCKS_DB = DB_DIR / "stocks.db"
ARCHIVE_DIR = DB_DIR / "archived_dead_tables"

# DBs المهجورة المحتملة (نتحقق من وجودها + حجمها)
DEAD_DB_CANDIDATES = [
    'crypto.db',
    'analytics.db',
    'community.db',
    'metrics.db',
    'custom.db',
    'data_engine.db',  # لو فاضي (0 bytes)
    'price_history.db',  # لو فاضي
    'predictions.db',   # لو فاضي — الـ SSOT هو stocks.db.predictions
]

# جداول في stocks.db موازية لـ predictions (نموذج قديم)
# نأرشفها (rename) بدل حذفها — Rule 1 (VERIFY-BEFORE-DELETE)
DEAD_TABLE_CANDIDATES = [
    'aiPrediction',
    'prediction_logs',
    'ExpertRecommendation',
    'tuned_predictions_summary',
    'real_evaluated_predictions',
    'maestro_personas',
    'cached_analysis',
    'conjunction_patterns',
    'indicator_trust_scores',
    'indicator_weights',
    'regime_indicator_weights',
    'stock_adaptive_profiles',
    'stock_phase',
    'stocks_backup',
    'egksco_stocks',
    'egksco_price_history',
    'egksco_sync_status',
]


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def check_db_alive(db_path: Path) -> Dict[str, Any]:
    """فحص هل DB مهجور (فاضي أو مفيش جداول مفيدة)."""
    info = {
        'path': str(db_path),
        'name': db_path.name,
        'exists': db_path.exists(),
        'size_bytes': 0,
        'size_mb': 0.0,
        'tables': [],
        'is_dead': False,
        'reason': '',
    }
    if not db_path.exists():
        info['is_dead'] = True
        info['reason'] = 'غير موجود'
        return info

    info['size_bytes'] = db_path.stat().st_size
    info['size_mb'] = round(info['size_bytes'] / (1024 * 1024), 2)

    # لو فاضي (0 bytes) → ميت
    if info['size_bytes'] == 0:
        info['is_dead'] = True
        info['reason'] = f'فاضي (0 bytes)'
        return info

    # لو أقل من 10KB → غالباً ميت
    if info['size_bytes'] < 10_000:
        info['is_dead'] = True
        info['reason'] = f'صغير جدًا ({info["size_bytes"]} bytes)'
        return info

    # فحص الجداول
    try:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        conn.close()
        info['tables'] = tables
        # لو مفيش جداول → ميت
        if not tables:
            info['is_dead'] = True
            info['reason'] = 'مفيش جداول'
        # لو فيه جداول بس كلها sqlite internal → ميت
        elif all(t.startswith('sqlite_') for t in tables):
            info['is_dead'] = True
            info['reason'] = 'فقط جداول sqlite internal'
    except Exception as e:
        info['is_dead'] = True
        info['reason'] = f'فشل الفتح: {e}'

    return info


def archive_dead_db(db_path: Path, dry_run: bool) -> Dict[str, Any]:
    """أرشفة DB ميتة (نقل لـ archived_dead_tables/)."""
    result = {'name': db_path.name, 'archived': False, 'archive_path': ''}
    if dry_run:
        result['archived'] = 'would-archive'
        return result

    ARCHIVE_DIR.mkdir(parents=True, exist_ok=True)
    archive_path = ARCHIVE_DIR / f"{db_path.name}.archived_{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    try:
        shutil.move(str(db_path), str(archive_path))
        result['archived'] = True
        result['archive_path'] = str(archive_path)
    except Exception as e:
        result['archived'] = False
        result['error'] = str(e)
    return result


def check_dead_tables_in_stocks_db(conn: sqlite3.Connection) -> List[Dict[str, Any]]:
    """حصر الجداول الموازية لـ predictions في stocks.db."""
    existing_tables = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}

    dead_found = []
    for tname in DEAD_TABLE_CANDIDATES:
        if tname in existing_tables:
            # نجيب عدد الصفوف
            try:
                count = conn.execute(f"SELECT COUNT(*) FROM {tname}").fetchone()[0]
            except Exception:
                count = -1
            dead_found.append({
                'table': tname,
                'row_count': count,
                'already_archived': tname.startswith('_archived_'),
            })
    return dead_found


def archive_table(conn: sqlite3.Connection, table: str, dry_run: bool) -> Dict[str, Any]:
    """أرشفة جدول ميت (rename لـ _archived_<name>)."""
    result = {'table': table, 'archived': False, 'new_name': ''}
    if dry_run:
        result['archived'] = 'would-archive'
        return result

    new_name = f"_archived_{table}_{datetime.now().strftime('%Y%m%d')}"
    try:
        conn.execute(f"ALTER TABLE {table} RENAME TO {new_name}")
        conn.commit()
        result['archived'] = True
        result['new_name'] = new_name
    except Exception as e:
        result['archived'] = False
        result['error'] = str(e)
    return result


def main() -> int:
    parser = argparse.ArgumentParser(description="أرشفة الجداول وقواعد البيانات المهجورة")
    parser.add_argument('--dry-run', action='store_true', help='تقرير فقط بدون تعديل')
    parser.add_argument('--json', action='store_true', help='JSON output')
    args = parser.parse_args()

    log("=" * 70)
    log("🧹 أرشفة الجداول وقواعد البيانات المهجورة — Archive Dead Tables")
    log("=" * 70)
    log(f"Mode: {'🔍 DRY-RUN' if args.dry_run else '⚡ EXECUTE'}")
    log("")

    # ── 1. فحص DBs المهجورة ──
    log("📊 فحص DBs المهجورة:")
    dead_dbs = []
    for db_name in DEAD_DB_CANDIDATES:
        db_path = DB_DIR / db_name
        info = check_db_alive(db_path)
        if info['exists']:
            status = "💀 ميت" if info['is_dead'] else "✅ حي"
            tables_count = len(info.get('tables', []))
            reason_or_tables = info['reason'] if info['reason'] else f'{tables_count} جداول'
            log(f"  {status} {db_name}: {info['size_mb']}MB | {reason_or_tables}")
            if info['is_dead']:
                dead_dbs.append(info)
        else:
            log(f"  ⚪ {db_name}: غير موجود")

    # أرشفة DBs الميتة
    archived_dbs = []
    if dead_dbs:
        log("")
        log(f"⚡ أرشفة {len(dead_dbs)} DB ميتة:")
        for info in dead_dbs:
            result = archive_dead_db(Path(info['path']), args.dry_run)
            archived_dbs.append(result)
            if result['archived'] is True:
                log(f"  ✅ {info['name']} → {result['archive_path']}", "OK")
            elif result['archived'] == 'would-archive':
                log(f"  ℹ️ {info['name']} → would-archive (dry-run)")

    # ── 2. فحص الجداول الميتة في stocks.db ──
    log("")
    log("📊 فحص الجداول الموازية لـ predictions في stocks.db:")

    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return 1

    conn = sqlite3.connect(str(STOCKS_DB))

    # نسخة احتياطية قبل أي تعديل
    if not args.dry_run:
        backup_path = DB_DIR / "backups" / f"stocks_db_before_archive_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
        backup_path.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(STOCKS_DB, backup_path)
        log(f"💾 نسخة احتياطية: {backup_path.name}", "OK")

    dead_tables = check_dead_tables_in_stocks_db(conn)

    if not dead_tables:
        log("  ✅ مفيش جداول موازية لـ predictions (نظيف)")
    else:
        log(f"  ⚠️ {len(dead_tables)} جداول موازية موجودة:")
        for t in dead_tables:
            log(f"    {t['table']}: {t['row_count']} صفوف")

    # أرشفة الجداول الميتة
    archived_tables = []
    if dead_tables and not args.dry_run:
        log("")
        log(f"⚡ أرشفة {len(dead_tables)} جدول ميت (rename لـ _archived_):")
        for t in dead_tables:
            if t['already_archived']:
                continue
            result = archive_table(conn, t['table'], args.dry_run)
            archived_tables.append(result)
            if result['archived'] is True:
                log(f"  ✅ {t['table']} → {result['new_name']}", "OK")
            else:
                log(f"  ❌ {t['table']}: {result.get('error', 'failed')}", "ERROR")

    # ── 3. تأكيد أن predictions هو المصدر الوحيد ──
    log("")
    log("📊 تأكيد أن predictions هو المصدر الوحيد:")
    pred_db_path = DB_DIR / "predictions.db"
    if pred_db_path.exists():
        with sqlite3.connect(str(pred_db_path)) as pred_conn:
            predictions_count = pred_conn.execute("SELECT COUNT(*) FROM predictions").fetchone()[0]
            log(f"  ✅ predictions.db -> predictions: {predictions_count} صف (المصدر الكنسي الوحيد)")
    else:
        log("  ⚠️ predictions.db غير موجود!", "WARN")

    # فحص لو فيه جداول تانية فيها توقعات
    prediction_like_tables = []
    existing = {r[0] for r in conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table'"
    ).fetchall()}
    for tname in existing:
        if tname == 'predictions' or tname.startswith('_archived_') or tname.startswith('sqlite_'):
            continue
        # فحص لو الجدول فيه أعمدة prediction-like
        try:
            cols = [r[1] for r in conn.execute(f"PRAGMA table_info({tname})").fetchall()]
            if any(c in cols for c in ['entry_price', 'target_price', 'stop_loss', 'signal']):
                prediction_like_tables.append(tname)
        except Exception:
            pass

    if prediction_like_tables:
        log(f"  ⚠️ جداول تانية فيها توقعات (لم تُؤرشف — راجعها): {prediction_like_tables}")
    else:
        log("  ✅ مفيش جداول تانية فيها توقعات — predictions هو الوحيد")

    conn.close()

    # تقرير نهائي
    report = {
        'timestamp': datetime.now(timezone.utc).isoformat(),
        'mode': 'dry-run' if args.dry_run else 'execute',
        'dead_dbs_found': len(dead_dbs),
        'dead_dbs_archived': len([d for d in archived_dbs if d.get('archived') is True]),
        'dead_tables_found': len(dead_tables),
        'dead_tables_archived': len([t for t in archived_tables if t.get('archived') is True]),
        'predictions_canonical_count': predictions_count,
        'prediction_like_tables_remaining': prediction_like_tables,
        'archived_dbs': archived_dbs,
        'archived_tables': archived_tables,
    }

    log("")
    log("=" * 70)
    log("📊 التقرير النهائي:")
    log(f"  DBs ميتة موجودة: {len(dead_dbs)}")
    log(f"  DBs مؤرشفة: {report['dead_dbs_archived']}")
    log(f"  جداول موازية موجودة: {len(dead_tables)}")
    log(f"  جداول مؤرشفة: {report['dead_tables_archived']}")
    log(f"  predictions (الكنسي): {predictions_count} صف")
    log(f"  جداول توقعات متبقية: {len(prediction_like_tables)}")
    log("=" * 70)

    if args.json:
        print(json.dumps(report, ensure_ascii=False, default=str, indent=2))

    return 0


if __name__ == '__main__':
    sys.exit(main())
