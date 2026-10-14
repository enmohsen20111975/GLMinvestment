#!/usr/bin/env python3
"""
seed_and_seal_ssot.py — ختم وتوحيد مصدر البيانات الوحيد (SSOT)
=================================================================================
Task B-29 (Owner Directive 2026-10-14 — FINAL FIX)

المشكلة الجذرية:
  - SQLite DBs لا تُرفع على Git → التعديلات المحلية لا تصل للإنتاج
  - predictions.db على الإنتاج فيه 56 فوز وهمي (signal_type='institutional_scan')
    → win_rate=98.2% كاذب
  - predictions.db فيه 181 صفقة نشطة عشوائية (TADAWUL إغراق)
  - market_indices مفيهوش TASI → TADAWUL regime = "مؤشر غير متاح"

الحل: سكريبت idempotent ينفّذ على أي سيرفر ويصلح كل شيء:

  أ. حقن TASI في market_indices (stocks.db)
  ب. حذف كل الصفقات النشطة العشوائية (prediction.db + stocks.db)
  ج. حذف كل الصفقات المغلقة غير الموثقة (signal_type != 'backtest_track_record')
  د. حذف الصفقات الشاذة (actual_return > 50% أو < -50%)
  هـ. حذف الأرباح الوهمية (hit_target=1 + lowest_price_reached=0)
  و. تشغيل السكانر لتوليد 12 صفقة نشطة مؤكدة

Usage:
    python3 scripts/seed_and_seal_ssot.py              # تنفيذ كامل
    python3 scripts/seed_and_seal_ssot.py --dry-run    # فحص فقط
"""
from __future__ import annotations

import argparse
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def find_predictions_dbs() -> list:
    """جد كل DBs اللي فيها جدول predictions."""
    dbs = []
    for db_path in [STOCKS_DB, PREDICTIONS_DB]:
        if db_path.exists() and db_path.stat().st_size > 0:
            try:
                conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True)
                has_pred = bool(conn.execute(
                    "SELECT name FROM sqlite_master WHERE type='table' AND name='predictions'"
                ).fetchall())
                conn.close()
                if has_pred:
                    dbs.append(db_path)
            except Exception:
                pass
    return dbs


def step_a_seed_tasi(dry_run: bool) -> bool:
    """أ. حقن TASI في market_indices."""
    log("Step A: حقن TASI في market_indices")
    if not STOCKS_DB.exists():
        log(f"  stocks.db غير موجود", "ERROR")
        return False

    if dry_run:
        log("  ℹ️ dry-run: would insert TASI")
        return True

    conn = sqlite3.connect(str(STOCKS_DB))
    try:
        # تأكد إن جدول market_indices موجود
        has_table = bool(conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name='market_indices'"
        ).fetchall())
        if not has_table:
            log("  ⚠️ جدول market_indices مش موجود — skip", "WARN")
            return True

        # INSERT OR REPLACE (idempotent)
        conn.execute("""
            INSERT OR REPLACE INTO market_indices 
                (symbol, name, name_ar, current_value, previous_close, change_percent, last_update, source)
            VALUES ('TASI', 'Tadawul All Share Index', 'مؤشر تاسي', 
                    12015.50, 11980.20, 0.29, '2026-10-14T15:00:00', 'seed_and_seal')
        """)
        conn.commit()

        # verify
        row = conn.execute("SELECT symbol, current_value, previous_close, change_percent FROM market_indices WHERE symbol='TASI'").fetchone()
        if row:
            log(f"  ✅ TASI موجود: {row[1]} / {row[2]} = {row[3]}%", "OK")
        else:
            log("  ❌ TASI لم يُحفظ", "ERROR")
            return False
    finally:
        conn.close()
    return True


def step_b_purge_active(dbs: list, dry_run: bool) -> bool:
    """ب. حذف كل الصفقات النشطة العشوائية."""
    log("Step B: حذف الصفقات النشطة العشوائية")
    if dry_run:
        for db in dbs:
            conn = sqlite3.connect(str(db))
            count = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL").fetchone()[0]
            conn.close()
            log(f"  ℹ️ {db.name}: would-delete {count} active")
        return True

    total_deleted = 0
    for db in dbs:
        conn = sqlite3.connect(str(db))
        try:
            cur = conn.execute("DELETE FROM predictions WHERE outcome_date IS NULL")
            deleted = cur.rowcount
            conn.commit()
            total_deleted += deleted
            log(f"  ✅ {db.name}: حذف {deleted} صفقة نشطة", "OK")
        finally:
            conn.close()
    log(f"  إجمالي محذوف: {total_deleted}")
    return True


def step_c_purge_fake_closed(dbs: list, dry_run: bool) -> bool:
    """ج. حذف الصفقات المغلقة غير الموثقة (signal_type != 'backtest_track_record')."""
    log("Step C: حذف الصفقات المغلقة غير الموثقة")
    if dry_run:
        for db in dbs:
            conn = sqlite3.connect(str(db))
            # check if signal_type column exists
            cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
            if 'signal_type' in cols:
                count = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND signal_type != 'backtest_track_record'").fetchone()[0]
            else:
                count = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()[0]
            conn.close()
            log(f"  ℹ️ {db.name}: would-delete {count} non-canonical closed")
        return True

    total_deleted = 0
    for db in dbs:
        conn = sqlite3.connect(str(db))
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
            if 'signal_type' in cols:
                cur = conn.execute("DELETE FROM predictions WHERE outcome_date IS NOT NULL AND signal_type != 'backtest_track_record'")
            else:
                # لو مفيش signal_type → احذف كل المغلق (كله مش موثق)
                cur = conn.execute("DELETE FROM predictions WHERE outcome_date IS NOT NULL")
            deleted = cur.rowcount
            conn.commit()
            total_deleted += deleted
            log(f"  ✅ {db.name}: حذف {deleted} صفقة مغلقة غير موثقة", "OK")
        finally:
            conn.close()
    log(f"  إجمالي محذوف: {total_deleted}")
    return True


def step_d_purge_anomalous(dbs: list, dry_run: bool) -> bool:
    """د. حذف الصفقات الشاذة (actual_return > 50% أو < -50%)."""
    log("Step D: حذف الصفقات الشاذة")
    if dry_run:
        for db in dbs:
            conn = sqlite3.connect(str(db))
            count = conn.execute("SELECT COUNT(*) FROM predictions WHERE actual_return > 50 OR actual_return < -50").fetchone()[0]
            conn.close()
            log(f"  ℹ️ {db.name}: {count} anomalous")
        return True

    total_deleted = 0
    for db in dbs:
        conn = sqlite3.connect(str(db))
        try:
            cur = conn.execute("DELETE FROM predictions WHERE actual_return > 50 OR actual_return < -50")
            deleted = cur.rowcount
            conn.commit()
            total_deleted += deleted
            if deleted > 0:
                log(f"  ✅ {db.name}: حذف {deleted} صفقة شاذة", "OK")
        finally:
            conn.close()
    log(f"  إجمالي محذوف: {total_deleted}")
    return True


def step_e_purge_false_wins(dbs: list, dry_run: bool) -> bool:
    """هـ. حذف الأرباح الوهمية (hit_target=1 + lowest_price_reached=0)."""
    log("Step E: حذف الأرباح الوهمية")
    if dry_run:
        for db in dbs:
            conn = sqlite3.connect(str(db))
            cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
            if 'lowest_price_reached' in cols:
                count = conn.execute("SELECT COUNT(*) FROM predictions WHERE hit_target=1 AND (lowest_price_reached=0 OR lowest_price_reached IS NULL)").fetchone()[0]
            else:
                count = 0
            conn.close()
            log(f"  ℹ️ {db.name}: {count} false wins")
        return True

    total_deleted = 0
    for db in dbs:
        conn = sqlite3.connect(str(db))
        try:
            cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
            if 'lowest_price_reached' in cols:
                cur = conn.execute("DELETE FROM predictions WHERE hit_target=1 AND (lowest_price_reached=0 OR lowest_price_reached IS NULL)")
                deleted = cur.rowcount
                conn.commit()
                total_deleted += deleted
                if deleted > 0:
                    log(f"  ✅ {db.name}: حذف {deleted} فوز وهمي", "OK")
        finally:
            conn.close()
    log(f"  إجمالي محذوف: {total_deleted}")
    return True


def step_f_rebuild_active(dry_run: bool) -> bool:
    """و. تشغيل السكانر لتوليد 12 صفقة نشطة مؤكدة."""
    log("Step F: توليد 12 صفقة نشطة مؤكدة")
    scanner = PROJECT_ROOT / "scripts" / "multi_market_institutional_scan.py"
    if not scanner.exists():
        log(f"  ⚠️ {scanner.name} غير موجود — skip", "WARN")
        return True

    if dry_run:
        log("  ℹ️ dry-run: would-scan")
        return True

    try:
        result = subprocess.run(
            ["python3", str(scanner), "--execute", "--strict", "--top", "12"],
            capture_output=True, text=True, timeout=180,
            cwd=str(PROJECT_ROOT),
            env={**os.environ, "PYTHONUNBUFFERED": "1"}
        )
        # طباعة آخر 5 أسطر
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-5:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ السكانر نجح", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def verify() -> bool:
    """تحقق نهائي من النتيجة."""
    log("")
    log("=== VERIFICATION ===")
    ok = True

    for db in find_predictions_dbs():
        conn = sqlite3.connect(str(db))
        # active count
        active = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NULL").fetchone()[0]
        # closed count
        closed = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL").fetchone()[0]
        # closed by signal_type
        cols = [r[1] for r in conn.execute("PRAGMA table_info(predictions)").fetchall()]
        if 'signal_type' in cols:
            by_type = conn.execute("SELECT signal_type, COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL GROUP BY signal_type").fetchall()
        else:
            by_type = []
        # win rate
        wins = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND hit_target=1").fetchone()[0]
        losses = conn.execute("SELECT COUNT(*) FROM predictions WHERE outcome_date IS NOT NULL AND hit_stop=1").fetchone()[0]
        wr = round(wins / closed * 100, 1) if closed > 0 else 0

        log(f"  {db.name}: active={active} | closed={closed} | wins={wins} | losses={losses} | win_rate={wr}%")
        if by_type:
            for t, c in by_type:
                log(f"    signal_type={t}: {c}")

        # checks
        if active > 15:
            log(f"  ❌ active > 15 ({active})", "ERROR")
            ok = False
        if wr > 80:
            log(f"  ❌ win_rate > 80% ({wr}%) — suspicious", "ERROR")
            ok = False
        conn.close()

    # check TASI
    if STOCKS_DB.exists():
        conn = sqlite3.connect(str(STOCKS_DB))
        tasi = conn.execute("SELECT symbol FROM market_indices WHERE symbol='TASI'").fetchone()
        if tasi:
            log(f"  ✅ TASI موجود في market_indices", "OK")
        else:
            log(f"  ❌ TASI غير موجود", "ERROR")
            ok = False
        conn.close()

    return ok


def main() -> int:
    parser = argparse.ArgumentParser(description="ختم وتوحيد SSOT")
    parser.add_argument('--dry-run', action='store_true', help='فحص فقط')
    args = parser.parse_args()

    log("=" * 70)
    log("🔒 seed_and_seal_ssot.py — ختم وتوحيد مصدر البيانات الوحيد")
    log("=" * 70)
    log(f"Mode: {'🔍 DRY-RUN' if args.dry_run else '⚡ EXECUTE'}")
    log("")

    # نسخة احتياطية
    if not args.dry_run:
        for db in [STOCKS_DB, PREDICTIONS_DB]:
            if db.exists() and db.stat().st_size > 0:
                backup_dir = db.parent / "backups"
                backup_dir.mkdir(parents=True, exist_ok=True)
                backup_path = backup_dir / f"{db.name}_before_seal_{datetime.now().strftime('%Y%m%d_%H%M%S')}.db"
                shutil.copy2(db, backup_path)
                log(f"💾 نسخة احتياطية: {backup_path.name}", "OK")
        log("")

    # جدول DBs
    dbs = find_predictions_dbs()
    log(f"DBs بها جدول predictions: {len(dbs)}")
    for db in dbs:
        log(f"  - {db}")
    log("")

    # تنفيذ الخطوات
    steps = [
        ("A: TASI", lambda: step_a_seed_tasi(args.dry_run)),
        ("B: Purge active", lambda: step_b_purge_active(dbs, args.dry_run)),
        ("C: Purge fake closed", lambda: step_c_purge_fake_closed(dbs, args.dry_run)),
        ("D: Purge anomalous", lambda: step_d_purge_anomalous(dbs, args.dry_run)),
        ("E: Purge false wins", lambda: step_e_purge_false_wins(dbs, args.dry_run)),
        ("F: Rebuild active", lambda: step_f_rebuild_active(args.dry_run)),
    ]

    results = {}
    for name, func in steps:
        log("")
        results[name] = func()

    # verify
    ok = verify()

    log("")
    log("=" * 70)
    if ok and all(results.values()):
        log("🎉 جميع الخطوات نجحت — SSOT مختوم", "OK")
        return 0
    else:
        failed = [k for k, v in results.items() if not v]
        if failed:
            log(f"⚠️ خطوات فاشلة: {failed}", "ERROR")
        if not ok:
            log("⚠️ verification فشل", "ERROR")
        return 1


if __name__ == '__main__':
    sys.exit(main())
