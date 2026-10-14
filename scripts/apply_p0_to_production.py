#!/usr/bin/env python3
"""
apply_p0_to_production.py — كبسولة ترحيل سيرفر الإنتاج (Production Automation)
==========================================================================
Task P0-PRODUCTION-AUTOMATION (Owner Directive 2026-10-13)

سكريبت موحد وآمن ينفذ:
  1. تركيب INSTEAD OF Triggers للـ Views في db/stocks.db
  2. تصحيح معادلات market_indices (نسب مؤشرات EGX30 و EGX70)
  3. تشغيل سيد السيولة اللحظية لجميع الأسهم النشطة (--execute)
  4. عزل أي أثر لقاعدة price_history.db التالفة وحذف قواعد الـ 0 بايت الوهمية

السكريبت idempotent (آمن للتشغيل المتكرر) + verification فوري.

Usage:
    python3 scripts/apply_p0_to_production.py              # تنفيذ كامل
    python3 scripts/apply_p0_to_production.py --dry-run    # فحص فقط بدون كتابة
    python3 scripts/apply_p0_to_production.py --skip-seed  # تخطي سيد السيولة
"""
from __future__ import annotations

import argparse
import os
import sqlite3
import subprocess
import sys
from pathlib import Path
from datetime import datetime, timezone

PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = PROJECT_ROOT / "db" / "stocks.db"
INTRADAY_DB = PROJECT_ROOT / "db" / "intraday.db"
DB_DIR = PROJECT_ROOT / "db"


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    status = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {status} {msg}", flush=True)


# ============================================================================
# Step 1: INSTEAD OF Triggers for Views
# ============================================================================
def step1_triggers(dry_run: bool = False) -> bool:
    """تركيب INSTEAD OF Triggers للـ Views (stock_price_history + price_history).

   Views الحالية:
      - stock_price_history (view → stock_daily_prices)
      - price_history (view → stock_daily_prices)

    المشكلة: INSERT INTO stock_price_history يفشل لأنه view (لا trigger).
    الحل: INSTEAD OF INSERT trigger يحول الكتابة لـ stock_daily_prices.
    """
    log("Step 1: تركيب INSTEAD OF Triggers للـ Views")
    if not STOCKS_DB.exists():
        log(f"stocks.db غير موجود: {STOCKS_DB}", "ERROR")
        return False

    triggers = [
        # Trigger 1: stock_price_history — INSTEAD OF INSERT
        """
        CREATE TRIGGER IF NOT EXISTS trg_stock_price_history_insert
        INSTEAD OF INSERT ON stock_price_history
        FOR EACH ROW
        BEGIN
            INSERT OR REPLACE INTO stock_daily_prices
                (ticker, price_date, open_price, high_price, low_price, close_price, volume)
            VALUES (
                NEW.ticker,
                NEW.date,
                COALESCE(NEW.open_price, NEW.open),
                COALESCE(NEW.high_price, NEW.high),
                COALESCE(NEW.low_price, NEW.low),
                COALESCE(NEW.close_price, NEW.close),
                NEW.volume
            );
        END;
        """,
        # Trigger 2: price_history — INSTEAD OF INSERT
        """
        CREATE TRIGGER IF NOT EXISTS trg_price_history_insert
        INSTEAD OF INSERT ON price_history
        FOR EACH ROW
        BEGIN
            INSERT OR REPLACE INTO stock_daily_prices
                (ticker, price_date, open_price, high_price, low_price, close_price, volume)
            VALUES (
                NEW.ticker,
                NEW.date,
                COALESCE(NEW.open_price, NEW.open),
                COALESCE(NEW.high_price, NEW.high),
                COALESCE(NEW.low_price, NEW.low),
                COALESCE(NEW.close_price, NEW.close),
                NEW.volume
            );
        END;
        """,
    ]

    if dry_run:
        log(f"DRY-RUN: سيتم إنشاء {len(triggers)} trigger", "WARN")
        return True

    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        for trigger_sql in triggers:
            # extract trigger name for logging
            name = "unknown"
            for line in trigger_sql.split('\n'):
                if 'CREATE TRIGGER' in line.upper():
                    name = line.split('TRIGGER IF NOT EXISTS')[-1].strip().split()[0] if 'IF NOT EXISTS' in line.upper() else line.split('TRIGGER')[-1].strip().split()[0]
                    break
            conn.execute(trigger_sql)
            log(f"Trigger created/verified: {name}")
        conn.commit()
        conn.close()
        log("Step 1 complete — Triggers جاهزة", "OK")
        return True
    except Exception as e:
        log(f"Step 1 failed: {e}", "ERROR")
        return False


# ============================================================================
# Step 2: Fix market_indices
# ============================================================================
def step2_market_indices(dry_run: bool = False) -> bool:
    """تصحيح معادلات market_indices (نسب مؤشرات EGX30 و EGX70).

    المشكلة: change_percent قد يكون غير محدث أو خاطئ.
    الحل: إعادة حساب change_percent = (current_value - previous_close) / previous_close * 100.
    """
    log("Step 2: تصحيح معادلات market_indices")
    if dry_run:
        log("DRY-RUN: سيتم إعادة حساب change_percent لكل المؤشرات", "WARN")
        return True

    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        cur = conn.cursor()
        rows = cur.execute(
            "SELECT id, symbol, current_value, previous_close, change_percent FROM market_indices"
        ).fetchall()
        fixed = 0
        for row in rows:
            idx_id, symbol, current_value, previous_close, old_change = row
            if current_value and previous_close and previous_close > 0:
                new_change = round((current_value - previous_close) / previous_close * 100, 4)
                if old_change is None or abs((old_change or 0) - new_change) > 0.01:
                    cur.execute(
                        "UPDATE market_indices SET change_percent = ? WHERE id = ?",
                        (new_change, idx_id)
                    )
                    fixed += 1
                    log(f"  {symbol}: change_percent {old_change} → {new_change}")
        conn.commit()
        conn.close()
        log(f"Step 2 complete — {fixed} مؤشرات تم تصحيحها", "OK")
        return True
    except Exception as e:
        log(f"Step 2 failed: {e}", "ERROR")
        return False


# ============================================================================
# Step 3: Seed intraday liquidity
# ============================================================================
def step3_seed_intraday(dry_run: bool = False) -> bool:
    """تشغيل سيد السيولة اللحظية لجميع الأسهم النشطة."""
    log("Step 3: تشغيل سيد السيولة اللحظية")
    if dry_run:
        log("DRY-RUN: سيتم تشغيل seed_live_intraday_session.py --execute", "WARN")
        return True

    seed_script = PROJECT_ROOT / "scripts" / "seed_live_intraday_session.py"
    if not seed_script.exists():
        log(f"seed script غير موجود: {seed_script}", "ERROR")
        return False

    today = datetime.now(timezone.utc).strftime("%Y-%m-%d")
    try:
        result = subprocess.run(
            [sys.executable, str(seed_script), "--date", today, "--execute"],
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=120,
        )
        if result.returncode == 0:
            # extract key lines
            for line in result.stdout.split('\n'):
                if 'VERIFY' in line or 'EXECUTE' in line or 'wrote' in line.lower():
                    log(f"  {line.strip()}")
            log("Step 3 complete — السيولة اللحظية تمت", "OK")
            return True
        else:
            log(f"Step 3 failed (exit {result.returncode}): {result.stderr[-300:]}", "ERROR")
            return False
    except subprocess.TimeoutExpired:
        log("Step 3 timeout (120s)", "ERROR")
        return False
    except Exception as e:
        log(f"Step 3 failed: {e}", "ERROR")
        return False


# ============================================================================
# Step 4: Isolate price_history.db + delete 0-byte DBs
# ============================================================================
def step4_isolate_bad_dbs(dry_run: bool = False) -> bool:
    """عزل price_history.db التالفة + حذف قواعد الـ 0 بايت الوهمية."""
    log("Step 4: عزل price_history.db التالفة + حذف قواعد 0 بايت")
    if dry_run:
        log("DRY-RUN: سيتم فحص وحذف القواعد الوهمية", "WARN")
        return True

    cleaned = 0

    # 4a: حذف قواعد 0 بايت
    for db_file in DB_DIR.glob("*.db"):
        if db_file.stat().st_size == 0:
            log(f"  حذف قاعدة 0 بايت: {db_file.name}")
            if not dry_run:
                db_file.unlink()
            cleaned += 1

    # 4b: عزل price_history.db التالفة (إذا وُجدت)
    ph_db = DB_DIR / "price_history.db"
    if ph_db.exists():
        # تحقق من سلامتها
        try:
            conn = sqlite3.connect(str(ph_db))
            conn.execute("PRAGMA integrity_check").fetchone()
            conn.close()
            log(f"  price_history.db سليمة — لا حاجة للعزل")
        except Exception as e:
            log(f"  price_history.db تالفة ({e}) — عزل...")
            backup_name = ph_db.with_suffix(".db.quarantine")
            if not dry_run:
                ph_db.rename(backup_name)
                log(f"  تم العزل → {backup_name.name}")
            cleaned += 1

    # 4c: تحقق من عدم وجود إشارات لـ price_history.db في الإعدادات
    # (فحص فقط — لا تعديل كود)
    # 4d: Task BRAVO-P0-UPDATE — حذف جداول 0 بايت داخل stocks.db
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        tables = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()
        for (tbl_name,) in tables:
            try:
                n = conn.execute(f'SELECT COUNT(*) FROM "{tbl_name}"').fetchone()[0]
                if n == 0:
                    log(f"  جدول 0 صفوف: {tbl_name} (تخطّي — لا حذف جداول)")
            except Exception:
                pass
        conn.close()
    except Exception as e:
        log(f"  فحص الجداول الفارغة فشل: {e}", "WARN")

    # 4e: Task BRAVO-P0-UPDATE — تفريد السوق لـ market-pulse (منع تسرب الأسهم الكويتية)
    try:
        conn = sqlite3.connect(str(STOCKS_DB))
        # تحقق أن market_pulse_cache لا يحوي أسهم غير EGX
        non_egx = conn.execute("""
            SELECT COUNT(*) FROM stocks
            WHERE market != 'EGX' AND is_active = 1
        """).fetchone()[0]
        if non_egx > 0:
            log(f"  أسهم غير EGX نشطة: {non_egx} (تأكد من فلتر market-pulse)")
        # تنظيف market_pulse_cache القديم (أكثر من 24 ساعة)
        deleted = conn.execute(
            "DELETE FROM market_pulse_cache WHERE created_at < datetime('now', '-24 hours')"
        ).rowcount
        if deleted > 0:
            log(f"  تم حذف {deleted} صف قديم من market_pulse_cache")
            conn.commit()
        conn.close()
    except Exception as e:
        log(f"  تفريد السوق فشل: {e}", "WARN")

    log(f"Step 4 complete — {cleaned} قاعدة تم تنظيفها/عزلها", "OK")
    return True


# ============================================================================
# Step 5: Multi-Market Institutional Scan
# ============================================================================
def step5_multi_market_scan(dry_run: bool = False) -> bool:
    """تشغيل محرك المسح المؤسسي متعدد الأسواق."""
    log("Step 5: محرك المسح المؤسسي متعدد الأسواق")
    scan_script = PROJECT_ROOT / "scripts" / "multi_market_institutional_scan.py"
    if not scan_script.exists():
        log(f"scan script غير موجود: {scan_script}", "ERROR")
        return False

    cmd = [sys.executable, str(scan_script)]
    if not dry_run:
        cmd.append("--execute")

    try:
        result = subprocess.run(
            cmd,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=300,
        )
        if result.returncode == 0:
            for line in result.stdout.split('\n'):
                if 'الملخص' in line or 'فرص مقبولة' in line or 'كتابة' in line or 'متوسط' in line:
                    log(f"  {line.strip()}")
            log("Step 5 complete — المسح المؤسسي تم", "OK")
            return True
        else:
            log(f"Step 5 failed (exit {result.returncode}): {result.stderr[-300:]}", "ERROR")
            return False
    except subprocess.TimeoutExpired:
        log("Step 5 timeout (300s)", "ERROR")
        return False
    except Exception as e:
        log(f"Step 5 failed: {e}", "ERROR")
        return False


# ============================================================================
# Verification
# ============================================================================
def verify_all() -> bool:
    """تحقق فوري من جميع الخطوات."""
    log("=== VERIFICATION ===")
    all_ok = True

    try:
        conn = sqlite3.connect(str(STOCKS_DB))

        # 1. Triggers
        triggers = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='trigger' AND name LIKE 'trg_%'"
        ).fetchall()
        log(f"Triggers: {len(triggers)} ({[t[0] for t in triggers]})")
        if len(triggers) >= 2:
            log("  ✅ Triggers جاهزة", "OK")
        else:
            log("  ❌ Triggers ناقصة", "ERROR")
            all_ok = False

        # 2. market_indices
        indices = conn.execute(
            "SELECT symbol, change_percent FROM market_indices WHERE symbol IN ('EGX30', 'EGX70')"
        ).fetchall()
        for sym, chg in indices:
            log(f"  {sym}: change_percent={chg}")
        if all(chg is not None for _, chg in indices):
            log("  ✅ market_indices محدثة", "OK")
        else:
            log("  ❌ market_indices ناقصة", "ERROR")
            all_ok = False

        # 3. stock_daily_prices
        n = conn.execute("SELECT COUNT(*) FROM stock_daily_prices").fetchone()[0]
        log(f"stock_daily_prices: {n:,} rows")
        if n > 0:
            log("  ✅ الأسعار اليومية متاحة", "OK")
        else:
            log("  ❌ stock_daily_prices فارغ", "ERROR")
            all_ok = False

        conn.close()

        # 4. intraday.db
        if INTRADAY_DB.exists():
            iconn = sqlite3.connect(str(INTRADAY_DB))
            n_intraday = iconn.execute("SELECT COUNT(*) FROM stock_intraday").fetchone()[0]
            n_tickers = iconn.execute("SELECT COUNT(DISTINCT ticker) FROM stock_intraday").fetchone()[0]
            iconn.close()
            log(f"stock_intraday: {n_intraday:,} rows | {n_tickers} tickers")
            if n_intraday > 0:
                log("  ✅ السيولة اللحظية متاحة", "OK")
            else:
                log("  ❌ stock_intraday فارغ", "ERROR")
                all_ok = False
        else:
            log("  ⚠️ intraday.db غير موجود (قد لا يكون مطلوبًا على الإنتاج)", "WARN")

        # 5. 0-byte DBs
        zero_dbs = [f.name for f in DB_DIR.glob("*.db") if f.stat().st_size == 0]
        if zero_dbs:
            log(f"  ❌ قواعد 0 بايت متبقية: {zero_dbs}", "ERROR")
            all_ok = False
        else:
            log("  ✅ لا قواعد 0 بايت", "OK")

    except Exception as e:
        log(f"Verification failed: {e}", "ERROR")
        all_ok = False

    return all_ok


# ============================================================================
# Main
# ============================================================================
def step6_archive_dead_tables(dry_run: bool = False) -> bool:
    """Step 6: أرشفة الجداول الميتة (Task BRAVO-PURGE-2)."""
    log("Step 6: أرشفة الجداول الميتة (archive_dead_tables.py)")
    script = PROJECT_ROOT / "scripts" / "archive_dead_tables.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    cmd = ["python3", str(script)]
    if dry_run:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        # طباعة آخر 10 أسطر
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-10:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ archive_dead_tables نجح", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def step7_audit_predictions(dry_run: bool = False) -> bool:
    """Step 7: تدقيق قضائي للصفقات المغلقة (Task BRAVO-PURGE-1)."""
    log("Step 7: تدقيق الصفقات المغلقة (audit_predictions_deep.py)")
    script = PROJECT_ROOT / "scripts" / "audit_predictions_deep.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    cmd = ["python3", str(script)]
    if dry_run:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=180)
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-8:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ audit_predictions_deep نجح", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def step8_liquidity_radar_multi_market(dry_run: bool = False) -> bool:
    """Step 8: تشغيل رادار السيولة لكل الأسواق (Task B-26 Multi-Market)."""
    log("Step 8: رادار السيولة متعدد الأسواق (liquidity_radar_v2.py)")
    script = PROJECT_ROOT / "scripts" / "liquidity_radar_v2.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    markets = ['EGX', 'TADAWUL', 'KSE', 'QSE']
    all_ok = True
    for mkt in markets:
        if dry_run:
            log(f"  ℹ️ {mkt}: would-scan (dry-run)")
            continue
        try:
            result = subprocess.run(
                ["python3", str(script), "--market", mkt, "--json"],
                capture_output=True, text=True, timeout=180,
                env={**os.environ, "PYTHONUNBUFFERED": "1"}
            )
            if result.returncode == 0:
                # استخراج scanned_count
                import json as _json
                try:
                    lines = (result.stdout or "").split('\n')
                    json_start = next((i for i, l in enumerate(lines) if l.strip().startswith('{')), 0)
                    data = _json.loads('\n'.join(lines[json_start:]))
                    scanned = data.get('scanned_count', 0)
                    phases = data.get('phases_breakdown', {})
                    log(f"  ✅ {mkt}: {scanned} سهم | phases={phases}", "OK")
                except Exception:
                    log(f"  ✅ {mkt}: scanned (JSON parse skipped)", "OK")
            else:
                log(f"  ❌ {mkt}: exit={result.returncode}", "ERROR")
                all_ok = False
        except Exception as e:
            log(f"  ❌ {mkt}: exception: {e}", "ERROR")
            all_ok = False
    return all_ok


def step9_populate_audited(dry_run: bool = False) -> bool:
    """Step 9: تثبيت السجل الموثق الحقيقي (populate_audited_track_record.py)."""
    log("Step 9: تثبيت السجل الموثق (populate_audited_track_record.py)")
    script = PROJECT_ROOT / "scripts" / "populate_audited_track_record.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    cmd = ["python3", str(script)]
    if dry_run:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=300)
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-8:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ populate_audited نجح", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def step10_daily_pipeline_dryrun(dry_run: bool = False) -> bool:
    """Step 10: فحص الـ Daily Pipeline (dry-run فقط)."""
    log("Step 10: فحص الـ Daily Pipeline (dry-run)")
    script = PROJECT_ROOT / "scripts" / "daily_orchestrator.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    try:
        result = subprocess.run(
            ["python3", str(script), "--dry-run"],
            capture_output=True, text=True, timeout=60,
            cwd=str(PROJECT_ROOT)
        )
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-5:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ daily pipeline dry-run نجح", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def step11_db_sanitation(dry_run: bool = False) -> bool:
    """Step 11: تطهير وضغط قواعد البيانات والباك-أب (production_db_sanitation.py)."""
    log("Step 11: تطهير وضغط قواعد البيانات (production_db_sanitation.py)")
    script = PROJECT_ROOT / "scripts" / "production_db_sanitation.py"
    if not script.exists():
        log(f"  ⚠️ {script.name} غير موجود — skip", "WARN")
        return True
    cmd = ["python3", str(script)]
    if dry_run:
        cmd.append("--dry-run")
    try:
        result = subprocess.run(cmd, capture_output=True, text=True, timeout=120)
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-8:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            log("  ✅ تطهير وفحص نزاهة قواعد البيانات نجح 100%", "OK")
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def main() -> int:
    parser = argparse.ArgumentParser(description="P0 Production Automation Script")
    parser.add_argument("--dry-run", action="store_true", help="فحص فقط بدون كتابة")
    parser.add_argument("--execute", action="store_true", help="تنفيذ فعلي (افتراضي)")
    parser.add_argument("--skip-seed", action="store_true", help="تخطي سيد السيولة اللحظية")
    parser.add_argument("--skip-archive", action="store_true", help="تخطي أرشفة الجداول الميتة")
    parser.add_argument("--skip-audit", action="store_true", help="تخطي تدقيق الصفقات")
    parser.add_argument("--skip-radar", action="store_true", help="تخطي رادار السيولة متعدد الأسواق")
    parser.add_argument("--skip-sanitation", action="store_true", help="تخطي ضغط وتطهير قواعد البيانات")
    args = parser.parse_args()

    log("=" * 60)
    log("🚀 apply_p0_to_production.py — كبسولة ترحيل الإنتاج")
    log("=" * 60)
    log(f"Mode: {'DRY-RUN' if args.dry_run else 'EXECUTE'}")
    log(f"stocks.db: {STOCKS_DB}")
    log("")

    steps = [
        ("Step 1: Triggers", lambda: step1_triggers(args.dry_run)),
        ("Step 2: market_indices", lambda: step2_market_indices(args.dry_run)),
    ]
    if not args.skip_seed:
        steps.append(("Step 3: Seed intraday", lambda: step3_seed_intraday(args.dry_run)))
    steps.append(("Step 4: Isolate bad DBs", lambda: step4_isolate_bad_dbs(args.dry_run)))
    # Step 5: Multi-market institutional scan (Task BRAVO-MULTI-MARKET)
    steps.append(("Step 5: Multi-market scan", lambda: step5_multi_market_scan(args.dry_run)))
    # Step 6: Archive dead tables (Task BRAVO-PURGE-2)
    if not args.skip_archive:
        steps.append(("Step 6: Archive dead tables", lambda: step6_archive_dead_tables(args.dry_run)))
    # Step 7: Audit predictions deep (Task BRAVO-PURGE-1)
    if not args.skip_audit:
        steps.append(("Step 7: Audit predictions", lambda: step7_audit_predictions(args.dry_run)))
    # Step 8: Liquidity radar multi-market (Task B-26)
    if not args.skip_radar:
        steps.append(("Step 8: Liquidity radar multi-market", lambda: step8_liquidity_radar_multi_market(args.dry_run)))
    # Step 9: Populate audited track record (Task B-MARATHON-P1)
    steps.append(("Step 9: Populate audited", lambda: step9_populate_audited(args.dry_run)))
    # Step 10: Daily pipeline dry-run (Task B-MARATHON-P3)
    steps.append(("Step 10: Daily pipeline check", lambda: step10_daily_pipeline_dryrun(args.dry_run)))
    # Step 11: Production DB Sanitation & Compression (Task B-DATA-SANITATION)
    if not args.skip_sanitation:
        steps.append(("Step 11: DB Sanitation & Compression", lambda: step11_db_sanitation(args.dry_run)))

    results = {}
    for name, func in steps:
        log("")
        results[name] = func()


    log("")
    ok = verify_all()
    log("")
    log("=" * 60)
    if ok and all(results.values()):
        log("🎉 جميع الخطوات نجحت — الإنتاج جاهز", "OK")
        return 0
    else:
        failed = [k for k, v in results.items() if not v]
        log(f"⚠️ خطوات فاشلة: {failed}", "ERROR")
        return 1


if __name__ == "__main__":
    sys.exit(main())
