#!/usr/bin/env python3
"""
daily_orchestrator.py — ماكينة التوقعات اليومية الآلية
=================================================================================
Task B-MARATHON-P3 (Owner Directive 2026-10-14)

ينفذ دورة الحياة الاستثمارية كاملة بالترتيب الصحيح:
  A. تحديث أسعار الإغلاق + المؤشرات (15:30 بعد إغلاق السوق)
  B. إغلاق الصفقات المفتوحة (15:45)
  C. توليد صفقات الغد (08:00 قبل الافتتاح)
  D. توليد كاش الـ Commercial Feed + الرادار (08:15)

Usage:
    python3 scripts/daily_orchestrator.py                    # دورة كاملة
    python3 scripts/daily_orchestrator.py --step A           # خطوة محددة
    python3 scripts/daily_orchestrator.py --dry-run          # فحص فقط
"""
from __future__ import annotations

import argparse
import os
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parent.parent
SCANNER = PROJECT_ROOT / "scripts" / "multi_market_institutional_scan.py"
COMMERCIAL_FEED = PROJECT_ROOT / "scripts" / "commercial_feed.py"
LIQUIDITY_RADAR = PROJECT_ROOT / "scripts" / "liquidity_radar_v2.py"
DAILY_CLOSER = PROJECT_ROOT / "vps-service" / "jobs" / "daily_closer.py"
DAILY_PREDICTOR = PROJECT_ROOT / "vps-service" / "jobs" / "daily_predictor.py"
PRICE_UPDATER = PROJECT_ROOT / "vps-service" / "scripts" / "daily_price_updater.py"
INDEX_UPDATER = PROJECT_ROOT / "vps-service" / "scripts" / "update_market_indices.py"


def log(msg: str, level: str = "INFO") -> None:
    ts = datetime.now(timezone.utc).strftime("%H:%M:%S")
    icon = "✅" if level == "OK" else ("⚠️" if level == "WARN" else ("❌" if level == "ERROR" else "▸"))
    print(f"[{ts}] {icon} {msg}", flush=True)


def run_script(script_path: Path, args: list, timeout: int = 180, dry_run: bool = False) -> bool:
    """تشغيل سكريبت بايثون بأمان."""
    if not script_path.exists():
        log(f"  ⚠️ {script_path.name} غير موجود — skip", "WARN")
        return True  # not a failure — just skip
    if dry_run:
        log(f"  ℹ️ dry-run: would-run {script_path.name} {' '.join(args)}")
        return True
    try:
        result = subprocess.run(
            ["python3", str(script_path)] + args,
            capture_output=True, text=True, timeout=timeout,
            cwd=str(PROJECT_ROOT),
            env={**os.environ, "PYTHONUNBUFFERED": "1"}
        )
        lines = (result.stdout or "").strip().split('\n')
        for line in lines[-3:]:
            if line.strip():
                log(f"  {line.strip()}")
        if result.returncode == 0:
            return True
        else:
            log(f"  ❌ exit={result.returncode}", "ERROR")
            if result.stderr:
                log(f"  stderr: {result.stderr[:200]}", "ERROR")
            return False
    except subprocess.TimeoutExpired:
        log(f"  ❌ timeout ({timeout}s)", "ERROR")
        return False
    except Exception as e:
        log(f"  ❌ exception: {e}", "ERROR")
        return False


def step_a_update_prices(dry_run: bool) -> bool:
    """A. تحديث أسعار الإغلاق + المؤشرات (15:30)."""
    log("Step A: تحديث أسعار الإغلاق + المؤشرات")
    ok1 = run_script(PRICE_UPDATER, [], timeout=300, dry_run=dry_run)
    ok2 = run_script(INDEX_UPDATER, [], timeout=120, dry_run=dry_run)
    return ok1 and ok2


def step_b_close_predictions(dry_run: bool) -> bool:
    """B. إغلاق الصفقات المفتوحة (15:45)."""
    log("Step B: إغلاق الصفقات المفتوحة")
    return run_script(DAILY_CLOSER, [], timeout=300, dry_run=dry_run)


def step_c_generate_signals(dry_run: bool) -> bool:
    """C. توليد صفقات الغد (08:00)."""
    log("Step C: توليد صفقات الغد (السكانر المؤسسي)")
    if dry_run:
        log("  ℹ️ dry-run: would-scan")
        return True
    return run_script(SCANNER, ["--execute", "--strict", "--top", "12"], timeout=180, dry_run=dry_run)


def step_d_generate_cache(dry_run: bool) -> bool:
    """D. توليد كاش الـ Commercial Feed + الرادار (08:15)."""
    log("Step D: توليد كاش Commercial Feed + الرادار")
    ok1 = run_script(COMMERCIAL_FEED, ["--json", "--market", "EGX"], timeout=30, dry_run=dry_run)
    ok2 = run_script(LIQUIDITY_RADAR, ["--market", "EGX", "--json"], timeout=180, dry_run=dry_run)
    return ok1 and ok2


def main() -> int:
    parser = argparse.ArgumentParser(description="ماكينة التوقعات اليومية الآلية")
    parser.add_argument('--step', type=str, default=None, choices=['A', 'B', 'C', 'D'],
                        help='تنفيذ خطوة محددة فقط')
    parser.add_argument('--dry-run', action='store_true', help='فحص فقط')
    args = parser.parse_args()

    log("=" * 70)
    log("🔄 daily_orchestrator.py — ماكينة التوقعات اليومية الآلية")
    log("=" * 70)
    log(f"Mode: {'🔍 DRY-RUN' if args.dry_run else '⚡ EXECUTE'}")
    if args.step:
        log(f"Step: {args.step} only")
    log("")

    all_steps = [
        ("A: Prices", lambda: step_a_update_prices(args.dry_run)),
        ("B: Close", lambda: step_b_close_predictions(args.dry_run)),
        ("C: Signals", lambda: step_c_generate_signals(args.dry_run)),
        ("D: Cache", lambda: step_d_generate_cache(args.dry_run)),
    ]

    if args.step:
        step_map = {'A': all_steps[0], 'B': all_steps[1], 'C': all_steps[2], 'D': all_steps[3]}
        all_steps = [step_map[args.step]]

    results = {}
    for name, func in all_steps:
        log("")
        results[name] = func()

    log("")
    log("=" * 70)
    ok = all(results.values())
    if ok:
        log("🎉 الدورة اليومية اكتملت بنجاح", "OK")
        return 0
    else:
        failed = [k for k, v in results.items() if not v]
        log(f"⚠️ خطوات فاشلة: {failed}", "ERROR")
        return 1


if __name__ == '__main__':
    sys.exit(main())
