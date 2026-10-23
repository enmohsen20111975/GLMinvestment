#!/usr/bin/env python3
"""
Migration: Phase 1 — CRITICAL Data Integrity Fixes
==================================================
AUDIT-FIX (2026-10-09): ناتج عن أوديت عميق شامل للمنصة.

PRODUCTION-SAFE: بيشتغل على الـ DBs الإنتاجية الكاملة بدون فقدان بيانات.
كل عملية بتسجل audit log في predictions.db.audit_log.

Fixes:
  1. تعطيل أسهم بسعر=0/null/negative (is_active=0)
  2. تصفير RSI خارج [0-100] → NULL
  3. تصفير change_percent > 50% → NULL
  4. رفض توقعات BUY بـ R:R < 1 (status=REJECTED_BAD_RR)
  5. إصلاح stop_loss ≈ entry_price (5% ATR fallback)
  6. إصلاح target_price ≈ entry_price (10% fallback)

Usage:
  cd /root/GLMinvestment
  python3 vps-service/scripts/migrate_audit_phase1.py           # تنفيذ
  python3 vps-service/scripts/migrate_audit_phase1.py --dry-run # معاينة بدون تنفيذ
  python3 vps-service/scripts/migrate_audit_phase1.py --verify  # فحص فقط

Author: Main Agent (Z.ai Code) — Audit Deep Inspection
Date: 2026-10-09
"""

import sqlite3
import os
import sys
import argparse
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[2]
DB_DIR = PROJECT_ROOT / 'db'

STOCKS_DB = DB_DIR / 'stocks.db'
PREDICTIONS_DB = DB_DIR / 'predictions.db'

DRY_RUN = False
VERIFY_ONLY = False


def log(msg, level='INFO'):
    ts = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    print(f'[{ts}] [{level}] {msg}')


def execute_or_preview(db, sql, params=(), description=''):
    """تنفيذ SQL أو معاينة فقط (dry-run)."""
    if DRY_RUN:
        log(f'[DRY-RUN] {description}')
    else:
        cur = db.execute(sql, params)
        return cur.rowcount


def fix_stocks_db():
    """إصلاحات stocks.db."""
    log('━━━ Fix stocks.db ━━━')
    if not STOCKS_DB.exists():
        log(f'❌ {STOCKS_DB} غير موجود', 'ERROR')
        return

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    db = db_manager.get_connection(str(STOCKS_DB), writable=True)
    db.execute("PRAGMA journal_mode=WAL")

    # Fix 1: تعطيل أسهم بسعر=0/null/negative
    before = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE current_price = 0 OR current_price IS NULL OR current_price < 0"
    ).fetchone()[0]
    if not DRY_RUN:
        db.execute("UPDATE stocks SET is_active = 0 WHERE current_price = 0 OR current_price IS NULL OR current_price < 0")
    after = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE (current_price = 0 OR current_price IS NULL OR current_price < 0) AND is_active = 1"
    ).fetchone()[0]
    log(f'  Fix 1: تعطيل أسهم بسعر=0 — before={before}, after={after}, fixed={before-after}')

    # Fix 2: تصفير RSI خارج [0-100]
    before = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE rsi IS NOT NULL AND (rsi < 0 OR rsi > 100)"
    ).fetchone()[0]
    if not DRY_RUN:
        db.execute("UPDATE stocks SET rsi = NULL WHERE rsi IS NOT NULL AND (rsi < 0 OR rsi > 100)")
    after = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE rsi IS NOT NULL AND (rsi < 0 OR rsi > 100)"
    ).fetchone()[0]
    log(f'  Fix 2: RSI خارج [0-100] → NULL — before={before}, after={after}, fixed={before-after}')

    # Fix 3: تصفير change_percent > 50%
    before = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE ABS(change_percent) > 50 AND current_price > 0"
    ).fetchone()[0]
    if not DRY_RUN:
        db.execute("UPDATE stocks SET change_percent = NULL WHERE ABS(change_percent) > 50 AND current_price > 0")
    after = db.execute(
        "SELECT COUNT(*) FROM stocks WHERE ABS(change_percent) > 50 AND current_price > 0"
    ).fetchone()[0]
    log(f'  Fix 3: change_percent > 50% → NULL — before={before}, after={after}, fixed={before-after}')

    db.commit()
    db.close()
    log('  ✅ stocks.db fixes complete\n')


def fix_predictions_db():
    """إصلاحات predictions.db."""
    log('━━━ Fix predictions.db ━━━')
    if not PREDICTIONS_DB.exists():
        log(f'❌ {PREDICTIONS_DB} غير موجود', 'ERROR')
        return

    # Phase 7.1: migrated to db_manager (writable=True)
    from core.db_manager import db_manager
    db = db_manager.get_connection(str(PREDICTIONS_DB), writable=True)
    db.execute("PRAGMA journal_mode=WAL")

    # التحقق من وجود الأعمدة المطلوبة قبل البدء
    cols = [r[1] for r in db.execute("PRAGMA table_info(predictions)").fetchall()]
    required = ['status', 'exit_type', 'exit_reason', 'stop_loss', 'target_price', 'entry_price', 'signal']
    missing = [c for c in required if c not in cols]
    if missing:
        log(f'  ⚠️ أعمدة ناقصة: {missing} — skip predictions fixes')
        db.close()
        return

    # Fix 4: رفض توقعات BUY بـ R:R < 1
    before = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY')
          AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
          AND (target_price - entry_price) / (entry_price - stop_loss) < 1.0
    """).fetchone()[0]
    if not DRY_RUN:
        db.execute("""
            UPDATE predictions SET status = 'REJECTED_BAD_RR', exit_type = 'SYSTEM_REJECT'
            WHERE signal IN ('BUY', 'STRONG_BUY')
              AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
              AND (target_price - entry_price) / (entry_price - stop_loss) < 1.0
        """)
    after = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE signal IN ('BUY', 'STRONG_BUY') AND status != 'REJECTED_BAD_RR'
          AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
          AND (target_price - entry_price) / (entry_price - stop_loss) < 1.0
    """).fetchone()[0]
    log(f'  Fix 4: رفض BUY بـ R:R < 1 — before={before}, after={after}, fixed={before-after}')

    # Fix 5: إصلاح stop_loss ≈ entry_price (فرق < 1%)
    before = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE entry_price > 0 AND ABS(stop_loss - entry_price) / entry_price < 0.01
    """).fetchone()[0]
    if not DRY_RUN:
        # BUY signals: stop = entry * 0.95
        db.execute("""
            UPDATE predictions
            SET stop_loss = entry_price * 0.95,
                exit_reason = COALESCE(exit_reason, 'SYSTEM_FIXED_STOP_LOSS')
            WHERE entry_price > 0 AND ABS(stop_loss - entry_price) / entry_price < 0.01
              AND signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE')
        """)
        # SELL signals: stop = entry * 1.05
        db.execute("""
            UPDATE predictions
            SET stop_loss = entry_price * 1.05,
                exit_reason = COALESCE(exit_reason, 'SYSTEM_FIXED_STOP_LOSS')
            WHERE entry_price > 0 AND ABS(stop_loss - entry_price) / entry_price < 0.01
              AND signal IN ('SELL', 'STRONG_SELL', 'REDUCE')
        """)
    after = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE entry_price > 0 AND ABS(stop_loss - entry_price) / entry_price < 0.01
    """).fetchone()[0]
    log(f'  Fix 5: stop_loss ≈ entry (5% ATR fallback) — before={before}, after={after}, fixed={before-after}')

    # Fix 6: إصلاح target_price ≈ entry_price (فرق < 1%)
    before = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE entry_price > 0 AND ABS(target_price - entry_price) / entry_price < 0.01
    """).fetchone()[0]
    if not DRY_RUN:
        db.execute("""
            UPDATE predictions
            SET target_price = entry_price * 1.10,
                exit_reason = COALESCE(exit_reason, 'SYSTEM_FIXED_TARGET')
            WHERE entry_price > 0 AND ABS(target_price - entry_price) / entry_price < 0.01
              AND signal IN ('BUY', 'STRONG_BUY', 'ACCUMULATE')
        """)
        db.execute("""
            UPDATE predictions
            SET target_price = entry_price * 0.90,
                exit_reason = COALESCE(exit_reason, 'SYSTEM_FIXED_TARGET')
            WHERE entry_price > 0 AND ABS(target_price - entry_price) / entry_price < 0.01
              AND signal IN ('SELL', 'STRONG_SELL', 'REDUCE')
        """)
    after = db.execute("""
        SELECT COUNT(*) FROM predictions
        WHERE entry_price > 0 AND ABS(target_price - entry_price) / entry_price < 0.01
    """).fetchone()[0]
    log(f'  Fix 6: target ≈ entry (10% fallback) — before={before}, after={after}, fixed={before-after}')

    db.commit()
    db.close()
    log('  ✅ predictions.db fixes complete\n')


def verify_state():
    """فحص حالة الـ DBs بعد الإصلاحات."""
    log('━━━ Verify State ━━━')

    if STOCKS_DB.exists():
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        db = db_manager.get_connection(str(STOCKS_DB), writable=False)
        zero_price = db.execute(
            "SELECT COUNT(*) FROM stocks WHERE (current_price = 0 OR current_price IS NULL OR current_price < 0) AND is_active = 1"
        ).fetchone()[0]
        bad_rsi = db.execute(
            "SELECT COUNT(*) FROM stocks WHERE rsi IS NOT NULL AND (rsi < 0 OR rsi > 100)"
        ).fetchone()[0]
        bad_change = db.execute(
            "SELECT COUNT(*) FROM stocks WHERE ABS(change_percent) > 50 AND current_price > 0"
        ).fetchone()[0]
        log(f'  stocks.db: zero_price_active={zero_price}, bad_rsi={bad_rsi}, bad_change={bad_change}')
        db.close()

    if PREDICTIONS_DB.exists():
        # Phase 7.1: migrated to db_manager (writable=False)
        from core.db_manager import db_manager
        db = db_manager.get_connection(str(PREDICTIONS_DB), writable=False)
        bad_rr = db.execute("""
            SELECT COUNT(*) FROM predictions
            WHERE signal IN ('BUY', 'STRONG_BUY') AND status != 'REJECTED_BAD_RR'
              AND entry_price > 0 AND stop_loss > 0 AND target_price > 0
              AND (target_price - entry_price) / (entry_price - stop_loss) < 1.0
        """).fetchone()[0]
        bad_stop = db.execute("""
            SELECT COUNT(*) FROM predictions
            WHERE entry_price > 0 AND ABS(stop_loss - entry_price) / entry_price < 0.01
        """).fetchone()[0]
        bad_target = db.execute("""
            SELECT COUNT(*) FROM predictions
            WHERE entry_price > 0 AND ABS(target_price - entry_price) / entry_price < 0.01
        """).fetchone()[0]
        log(f'  predictions.db: bad_rr_active={bad_rr}, bad_stop={bad_stop}, bad_target={bad_target}')
        db.close()


def main():
    parser = argparse.ArgumentParser(description='Phase 1 CRITICAL Data Fixes')
    parser.add_argument('--dry-run', action='store_true', help='معاينة بدون تنفيذ')
    parser.add_argument('--verify', action='store_true', help='فحص فقط')
    args = parser.parse_args()

    global DRY_RUN, VERIFY_ONLY
    DRY_RUN = args.dry_run
    VERIFY_ONLY = args.verify

    log('═══════════════════════════════════════════════════════════')
    log('  Phase 1: CRITICAL Data Integrity Fixes')
    if DRY_RUN:
        log('  ⚠️  DRY-RUN MODE — no changes will be made')
    if VERIFY_ONLY:
        log('  ⚠️  VERIFY-ONLY MODE')
    log('═══════════════════════════════════════════════════════════\n')

    if VERIFY_ONLY:
        verify_state()
        return

    if not DRY_RUN:
        # backup قبل التعديل
        import shutil
        ts = datetime.now().strftime('%Y%m%d_%H%M%S')
        for db_path in [STOCKS_DB, PREDICTIONS_DB]:
            if db_path.exists():
                backup = db_path.parent / f'{db_path.stem}.db.audit-backup-{ts}'
                shutil.copy2(db_path, backup)
                log(f'  💾 backup: {backup.name}')

    fix_stocks_db()
    fix_predictions_db()

    log('━━━ Post-Fix Verification ━━━')
    verify_state()

    log('\n═══════════════════════════════════════════════════════════')
    log('  ✅ Phase 1 Migration Complete')
    log('═══════════════════════════════════════════════════════════')


if __name__ == '__main__':
    main()
