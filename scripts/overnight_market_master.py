#!/usr/bin/env python3
"""
overnight_market_master.py — المعالج الليلي الشامل الهادئ
=================================================================
Task: BRAVO-OVERNIGHT-MASTER (Owner Directive 2026-10-12)

سكربت ليلي مهذب يبني التوقعات لكل الأسواق الستة (CRYPTO, KSA, US, KSE, QSE, EGX)
على مدار الليل دون استهلاك موارد الخادم.

مبادئ "العمل على الهادي" (Low-Resource Polite Runner):
  1. كل مرحلة تعمل في Python Subprocess منفصل (عزل الذاكرة).
  2. بعد كل مرحلة: gc.collect() لتفريغ الذاكرة + نوم 10 دقائق كاملة
     (time.sleep(600)) لراحة الـ CPU وتجنب Database Locks.
  3. عرض عد تنازلي لطيف في الكونسول أثناء النوم.
  4. timeout=30.0 في كل اتصالات SQLite لمنع قفل الجداول.
  5. كل المخرجات تُكتب إلى logs/overnight_run.log مباشرة.

المراحل الست:
  Phase 1: CRYPTO — daily_predictor.py --market CRYPTO --today-only --max-picks 5
  Phase 2: KSA    — daily_predictor.py --market KSA --today-only --max-picks 5
  Phase 3: US     — daily_predictor.py --market US --today-only --max-picks 5
  Phase 4: KSE & QSE — KSE ثم QSE بفاصل 5 دقائق
  Phase 5: EGX    — daily_predictor.py --market EGX + daily_closer.py
  Phase 6: التقرير الصباحي الشامل — overnight_summary.json

Usage:
    python3 scripts/overnight_market_master.py            # تشغيل كامل
    python3 scripts/overnight_market_master.py --dry-run  # فحص البنية فقط (بدون subprocess/sleep حقيقي)
    python3 scripts/overnight_market_master.py --phase EGX  # مرحلة واحدة فقط

Rule 27 (NO-FAKE-DATA): لا اختلاق — السكربت يفوض التوليد لـ daily_predictor.py
Rule 20 (PYTHON = BRAIN): كل المنطق في Python
Rule 75 (GIT DISCIPLINE): commit + push
"""
from __future__ import annotations

import argparse
import gc
import json
import os
import sqlite3
import subprocess
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Dict, List, Optional

# ─────────────────────────────────────────────────────────────────────────────
# إعدادات المسارات
# ─────────────────────────────────────────────────────────────────────────────
PROJECT_ROOT = Path(__file__).resolve().parent.parent
DAILY_PREDICTOR = PROJECT_ROOT / "vps-service" / "jobs" / "daily_predictor.py"
DAILY_CLOSER = PROJECT_ROOT / "vps-service" / "jobs" / "daily_closer.py"
PREDICTIONS_DB = PROJECT_ROOT / "db" / "predictions.db"
REPORTS_DIR = PROJECT_ROOT / "db" / "reports"
LOGS_DIR = PROJECT_ROOT / "logs"
OVERNIGHT_REPORT = REPORTS_DIR / "overnight_summary.json"
OVERNIGHT_LOG = LOGS_DIR / "overnight_run.log"

# إعدادات "العمل على الهادي"
SQLITE_TIMEOUT = 30.0  # ثانية لمنع قفل الجداول
LONG_REST_SECONDS = 600  # 10 دقائق نوم هادئ بين المراحل الكبرى
SHORT_REST_SECONDS = 300  # 5 دقائق نوم بين المراحل الصغيرة
DRY_RUN_PHASE_SECONDS = 3  # في --dry-run، نوم قصير فقط للعرض

PYTHON_EXEC = sys.executable  # python3 الفعلي

# ─────────────────────────────────────────────────────────────────────────────
# نظام الـ Logging المزدوج (console + file)
# ─────────────────────────────────────────────────────────────────────────────
def log(msg: str, level: str = "INFO") -> None:
    """اطبع على console + اكتب في logs/overnight_run.log مباشرة."""
    ts = datetime.now(timezone.utc).strftime("%Y-%m-%d %H:%M:%S UTC")
    line = f"[{ts}] [{level}] {msg}"
    print(line, flush=True)
    try:
        LOGS_DIR.mkdir(parents=True, exist_ok=True)
        with open(OVERNIGHT_LOG, "a", encoding="utf-8") as f:
            f.write(line + "\n")
    except Exception as e:
        print(f"  ⚠️ فشل كتابة الـ log: {e}", flush=True)


def countdown_sleep(seconds: int, label: str = "استراحة هادئة", dry_run: bool = False) -> None:
    """نوم هادئ مع عد تنازلي لطيف في الكونسول.

    في --dry-run: نوم قصير (3 ثواني) فقط للعرض.
    """
    if dry_run:
        actual = min(seconds, DRY_RUN_PHASE_SECONDS)
        log(f"  ⏸️  {label} (DRY-RUN: {actual}s بدل {seconds}s)")
        time.sleep(actual)
        return

    log(f"  ⏸️  {label} ({seconds // 60} دقيقة {seconds % 60} ثانية)")
    # عد تنازلي لطيف — يطبع كل دقيقة
    remaining = seconds
    while remaining > 0:
        mins = remaining // 60
        secs = remaining % 60
        # اطبع كل دقيقة (لا تطفح الـ console)
        if remaining % 60 == 0 or remaining == seconds:
            print(f"     ⏳ متبقي: {mins:02d}:{secs:02d}", flush=True, end="\r")
        time.sleep(1)
        remaining -= 1
    print(" " * 40, end="\r")  # امسح خط العد التنازلي
    log(f"  ✅ انتهت الاستراحة")


# ─────────────────────────────────────────────────────────────────────────────
# تشغيل مرحلة في subprocess منفصل (عزل الذاكرة)
# ─────────────────────────────────────────────────────────────────────────────
def run_phase(
    phase_name: str,
    command: List[str],
    dry_run: bool = False,
    timeout: int = 1800,  # 30 دقيقة كحد أقصى لكل مرحلة
) -> Dict[str, Any]:
    """شغّل مرحلة في subprocess منفصل + ارجع النتيجة.

    Returns: {phase, success, returncode, duration_seconds, stdout_tail, stderr_tail}
    """
    log(f"")
    log(f"{'=' * 70}")
    log(f"🚀 {phase_name}")
    log(f"{'=' * 70}")
    log(f"  الأمر: {' '.join(command)}")

    if dry_run:
        log(f"  🧪 DRY-RUN: تخطي التنفيذ الفعلي")
        return {
            "phase": phase_name,
            "success": True,
            "returncode": 0,
            "duration_seconds": 0,
            "dry_run": True,
            "stdout_tail": "(dry-run — no output)",
            "stderr_tail": "",
        }

    t0 = time.time()
    try:
        # شغّل في subprocess منفصل لعزل الذاكرة
        result = subprocess.run(
            command,
            cwd=str(PROJECT_ROOT),
            capture_output=True,
            text=True,
            timeout=timeout,
            env={**os.environ, "PROJECT_ROOT": str(PROJECT_ROOT)},
        )
        duration = time.time() - t0
        success = result.returncode == 0

        # اطبع آخر 500 حرف من stdout/stderr
        stdout_tail = (result.stdout or "")[-500:]
        stderr_tail = (result.stderr or "")[-500:]
        if stdout_tail.strip():
            log(f"  📤 stdout (tail):\n{stdout_tail.strip()}")
        if stderr_tail.strip():
            log(f"  📤 stderr (tail):\n{stderr_tail.strip()}")

        status = "✅ نجح" if success else "❌ فشل"
        log(f"  {status} — returncode={result.returncode} | duration={duration:.1f}s")

        return {
            "phase": phase_name,
            "success": success,
            "returncode": result.returncode,
            "duration_seconds": round(duration, 1),
            "stdout_tail": stdout_tail,
            "stderr_tail": stderr_tail,
        }
    except subprocess.TimeoutExpired:
        duration = time.time() - t0
        log(f"  ⏰ TIMEOUT بعد {duration:.1f}s", level="ERROR")
        return {
            "phase": phase_name,
            "success": False,
            "returncode": -1,
            "duration_seconds": round(duration, 1),
            "error": "timeout",
            "stdout_tail": "",
            "stderr_tail": f"Timeout after {timeout}s",
        }
    except Exception as e:
        duration = time.time() - t0
        log(f"  ❌ استثناء: {e}", level="ERROR")
        return {
            "phase": phase_name,
            "success": False,
            "returncode": -2,
            "duration_seconds": round(duration, 1),
            "error": str(e),
            "stdout_tail": "",
            "stderr_tail": str(e),
        }


# ─────────────────────────────────────────────────────────────────────────────
# إحصائيات التوقعات من predictions.db (للتقرير الصباحي)
# ─────────────────────────────────────────────────────────────────────────────
def collect_predictions_stats() -> Dict[str, Any]:
    """اجمع إحصائيات التوقعات من predictions.db لكل سوق.

    SQLite timeout=30.0 لمنع قفل الجداول.
    """
    stats: Dict[str, Any] = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "db_path": str(PREDICTIONS_DB),
        "markets": {},
        "totals": {
            "active_predictions": 0,
            "accepted_tonight": 0,
            "rejected_by_lgbm_gatekeeper": 0,
        },
    }

    if not PREDICTIONS_DB.exists():
        log(f"  ⚠️ predictions.db غير موجود: {PREDICTIONS_DB}", level="WARN")
        stats["error"] = "predictions.db not found"
        return stats

    try:
        conn = sqlite3.connect(
            f"file:{PREDICTIONS_DB}?mode=ro", uri=True, timeout=SQLITE_TIMEOUT
        )
        cur = conn.cursor()

        # تحقق من وجود الجداول المطلوبة
        tables = [r[0] for r in cur.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]

        if "predictions" in tables:
            # إجمالي التوقعات النشطة (لكل سوق)
            # predictions table قد يحوي column `market`
            cols = [r[1] for r in cur.execute("PRAGMA table_info(predictions)").fetchall()]
            market_col = "market" if "market" in cols else None

            if market_col:
                # إحصائيات لكل سوق
                market_counts = cur.execute(
                    f"SELECT {market_col}, COUNT(*) FROM predictions "
                    f"GROUP BY {market_col} ORDER BY COUNT(*) DESC"
                ).fetchall()
                for market, count in market_counts:
                    market_key = (market or "unknown").upper()
                    stats["markets"][market_key] = {
                        "active_predictions": count,
                        "accepted_tonight": 0,  # سيُحدّث لاحقًا
                        "rejected_by_lgbm_gatekeeper": 0,
                    }
                    stats["totals"]["active_predictions"] += count

            # إجمالي التوقعات
            total_active = cur.execute(
                "SELECT COUNT(*) FROM predictions"
            ).fetchone()[0]
            stats["totals"]["active_predictions"] = total_active

        # عدد التوقعات المرفوضة من LGBM Gatekeeper (لو الجدول موجود)
        # predictions.db قد يحوي radar_signal_tracking بـ status='REJECTED_BY_AI_GATEKEEPER'
        # لكن هذا في stocks.db عادةً. نتحقق من كلا DB.
        rejected_count = 0
        # جرّب predictions.db أولاً
        if "radar_signal_tracking" in tables:
            try:
                rejected_count = cur.execute(
                    "SELECT COUNT(*) FROM radar_signal_tracking "
                    "WHERE status = 'REJECTED_BY_AI_GATEKEEPER'"
                ).fetchone()[0]
            except Exception:
                pass

        # جرّب stocks.db
        stocks_db = PROJECT_ROOT / "db" / "stocks.db"
        if stocks_db.exists() and rejected_count == 0:
            try:
                sconn = sqlite3.connect(
                    f"file:{stocks_db}?mode=ro", uri=True, timeout=SQLITE_TIMEOUT
                )
                scur = sconn.cursor()
                s_tables = [r[0] for r in scur.execute(
                    "SELECT name FROM sqlite_master WHERE type='table'"
                ).fetchall()]
                if "radar_signal_tracking" in s_tables:
                    rejected_count = scur.execute(
                        "SELECT COUNT(*) FROM radar_signal_tracking "
                        "WHERE status = 'REJECTED_BY_AI_GATEKEEPER'"
                    ).fetchone()[0]
                sconn.close()
            except Exception as e:
                log(f"  ⚠️ فشل قراءة rejected من stocks.db: {e}", level="WARN")

        stats["totals"]["rejected_by_lgbm_gatekeeper"] = rejected_count

        # التوقعات المقبولة الليلة (المُنشأة اليوم)
        today_str = datetime.now(timezone.utc).strftime("%Y-%m-%d")
        try:
            accepted_today = cur.execute(
                "SELECT COUNT(*) FROM predictions WHERE prediction_date LIKE ?",
                (f"{today_str}%",),
            ).fetchone()[0]
            stats["totals"]["accepted_tonight"] = accepted_today
        except Exception:
            # لو مفيش prediction_date column
            stats["totals"]["accepted_tonight"] = 0

        conn.close()
    except Exception as e:
        log(f"  ❌ فشل جمع الإحصائيات: {e}", level="ERROR")
        stats["error"] = str(e)

    return stats


# ─────────────────────────────────────────────────────────────────────────────
# طباعة التقرير الصباحي في الكونسول (جدول عربي أنيق)
# ─────────────────────────────────────────────────────────────────────────────
def print_morning_report(stats: Dict[str, Any]) -> None:
    """اطبع جدول كونسول عربي أنيق بنتائج الليلة."""
    log("")
    log("🌅 التقرير الصباحي الشامل — المعالج الليلي")
    log("=" * 70)

    totals = stats.get("totals", {})
    log(f"  📊 الإجماليات:")
    log(f"     • إجمالي التوقعات النشطة:        {totals.get('active_predictions', 0):,}")
    log(f"     • الصفقات المقبولة الليلة:        {totals.get('accepted_tonight', 0):,}")
    log(f"     • المرفوضة بحارس البوابة LGBM:    {totals.get('rejected_by_lgbm_gatekeeper', 0):,}")
    log("")

    markets = stats.get("markets", {})
    if markets:
        log(f"  📋 التوزيع حسب السوق:")
        log(f"  {'السوق':<12} | {'التوقعات النشطة':>18}")
        log(f"  {'-' * 12} | {'-' * 18}")
        for market, data in sorted(markets.items()):
            active = data.get("active_predictions", 0)
            log(f"  {market:<12} | {active:>18,}")
    else:
        log(f"  ⚠️ لا توجد بيانات سوق متاحة في predictions.db")

    log("")
    log(f"  💾 التقرير JSON: {OVERNIGHT_REPORT}")
    log("=" * 70)


# ─────────────────────────────────────────────────────────────────────────────
# تعريف المراحل الست
# ─────────────────────────────────────────────────────────────────────────────
def build_phases() -> List[Dict[str, Any]]:
    """ابنِ قائمة المراحل الست بمواصفاتها."""
    return [
        {
            "name": "المرحلة 1: CRYPTO (العملات الرقمية 24/7)",
            "short": "CRYPTO",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "CRYPTO", "--today-only", "--max-picks", "5"],
            "rest_after": LONG_REST_SECONDS,
            "rest_label": "استراحة 10 دقائق بعد CRYPTO",
        },
        {
            "name": "المرحلة 2: KSA (السوق السعودي)",
            "short": "KSA",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "KSA", "--today-only", "--max-picks", "5"],
            "rest_after": LONG_REST_SECONDS,
            "rest_label": "استراحة 10 دقائق بعد KSA",
        },
        {
            "name": "المرحلة 3: US (السوق الأمريكي)",
            "short": "US",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "US", "--today-only", "--max-picks", "5"],
            "rest_after": LONG_REST_SECONDS,
            "rest_label": "استراحة 10 دقائق بعد US",
        },
        {
            "name": "المرحلة 4a: KSE (الكويت)",
            "short": "KSE",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "KSE", "--today-only", "--max-picks", "5"],
            "rest_after": SHORT_REST_SECONDS,  # 5 دقائق بين KSE و QSE
            "rest_label": "استراحة 5 دقائق بين KSE و QSE",
        },
        {
            "name": "المرحلة 4b: QSE (قطر)",
            "short": "QSE",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "QSE", "--today-only", "--max-picks", "5"],
            "rest_after": LONG_REST_SECONDS,
            "rest_label": "استراحة 10 دقائق بعد QSE",
        },
        {
            "name": "المرحلة 5a: EGX (السوق المصري) — التوقعات",
            "short": "EGX",
            "command": [PYTHON_EXEC, str(DAILY_PREDICTOR), "--market", "EGX", "--today-only", "--max-picks", "5"],
            "rest_after": 0,  # لا راحة — انتقل مباشرة لـ daily_closer
            "rest_label": "",
        },
        {
            "name": "المرحلة 5b: EGX — daily_closer (إغلاق يومي)",
            "short": "EGX_CLOSER",
            "command": [PYTHON_EXEC, str(DAILY_CLOSER)],
            "rest_after": SHORT_REST_SECONDS,
            "rest_label": "استراحة 5 دقائق بعد EGX",
        },
    ]


# ─────────────────────────────────────────────────────────────────────────────
# الدالة الرئيسية
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(
        description="المعالج الليلي الشامل الهادئ — يبني التوقعات لكل الأسواق الستة",
    )
    parser.add_argument(
        "--dry-run",
        action="store_true",
        help="فحص البنية فقط — بدون subprocess/sleep حقيقي",
    )
    parser.add_argument(
        "--phase",
        type=str,
        default=None,
        help="شغّل مرحلة واحدة فقط (CRYPTO, KSA, US, KSE, QSE, EGX, EGX_CLOSER)",
    )
    args = parser.parse_args()

    # تهيئة المجلدات
    LOGS_DIR.mkdir(parents=True, exist_ok=True)
    REPORTS_DIR.mkdir(parents=True, exist_ok=True)

    log("")
    log("🌙" * 35)
    log("🌙  المعالج الليلي الشامل الهادئ — overnight_market_master.py  🌙")
    log("🌙" * 35)
    log(f"  المشروع: {PROJECT_ROOT}")
    log(f"  Python:  {PYTHON_EXEC}")
    log(f"  Log:     {OVERNIGHT_LOG}")
    log(f"  Mode:    {'DRY-RUN (فحص بنية)' if args.dry_run else 'تشغيل كامل'}")
    if args.phase:
        log(f"  Phase:   {args.phase} فقط")
    log("")

    phases = build_phases()
    # فلتر مرحلة واحدة لو --phase محدد
    if args.phase:
        phase_upper = args.phase.upper()
        phases = [p for p in phases if p["short"] == phase_upper]
        if not phases:
            log(f"❌ مرحلة غير معروفة: {args.phase}", level="ERROR")
            log(f"   المراحل المتاحة: CRYPTO, KSA, US, KSE, QSE, EGX, EGX_CLOSER")
            return 1

    results: List[Dict[str, Any]] = []
    t_start = time.time()

    # ── شغّل كل مرحلة ──
    for i, phase in enumerate(phases, 1):
        log(f"\n📍 المرحلة {i}/{len(phases)}")
        result = run_phase(
            phase_name=phase["name"],
            command=phase["command"],
            dry_run=args.dry_run,
        )
        results.append(result)

        # gc.collect بعد كل مرحلة (تفريغ الذاكرة)
        if not args.dry_run:
            log(f"  🧹 gc.collect() — تفريغ الذاكرة")
            gc.collect()

        # استراحة هادئة بعد المرأة (إلا لو آخر مرحلة)
        if phase["rest_after"] > 0 and i < len(phases):
            countdown_sleep(
                seconds=phase["rest_after"],
                label=phase["rest_label"],
                dry_run=args.dry_run,
            )

    # ── المرحلة 6: التقرير الصباحي الشامل ──
    log(f"\n📍 المرحلة {len(phases) + 1}/{len(phases) + 1}")
    log("=" * 70)
    log("📋 المرحلة 6: التقرير الصباحي الشامل")
    log("=" * 70)

    stats = collect_predictions_stats()

    # أضف نتائج المراحل للـ report
    stats["phases_executed"] = [
        {
            "phase": r.get("phase"),
            "success": r.get("success"),
            "returncode": r.get("returncode"),
            "duration_seconds": r.get("duration_seconds"),
        }
        for r in results
    ]
    stats["total_duration_seconds"] = round(time.time() - t_start, 1)
    stats["dry_run"] = args.dry_run

    # احفظ التقرير JSON
    try:
        with open(OVERNIGHT_REPORT, "w", encoding="utf-8") as f:
            json.dump(stats, f, ensure_ascii=False, indent=2)
        log(f"  💾 تم حفظ التقرير: {OVERNIGHT_REPORT}")
    except Exception as e:
        log(f"  ❌ فشل حفظ التقرير: {e}", level="ERROR")

    # اطبع الجدول العربي في الكونسول
    print_morning_report(stats)

    # ملخص نهائي
    log(f"\n⏱️  إجمالي مدة التشغيل: {stats['total_duration_seconds']}s")
    successful = sum(1 for r in results if r.get("success"))
    failed = len(results) - successful
    log(f"✅ مراحل ناجحة: {successful}/{len(results)}")
    if failed > 0:
        log(f"❌ مراحل فاشلة: {failed}/{len(results)}", level="WARN")

    log(f"\n🌙 انتهى المعالج الليلي. ملف الـ log: {OVERNIGHT_LOG}")
    log("=" * 70)

    return 0 if failed == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
