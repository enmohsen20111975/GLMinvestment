#!/usr/bin/env python3
"""
data_engine_unify.py — سكربت توحيد محرك البيانات (DATA-ENGINE-UNIFY-1)
=====================================================================

سكربت شامل بيـ run كل إصلاحات tab_* على الـ DBs.
آمن للـ laptop (sandbox) + السيرفر الإنتاجي.

المراحل:
  1. backup الـ DBs (snapshot قبل أي تعديل).
  2. شغل repair_tab_symbols.py (إصلاح الـ 3704 polluted ticker).
  3. DELETE الـ shifted rows (symbol='السعودية' في tab_balance_sheet/...).
  4. verify (تأكد إن الـ pollution = 0).
  5. report (JSON + console).

الاستخدام:
  python3 scripts/data_engine_unify.py              # dry-run (default)
  python3 scripts/data_engine_unify.py --apply      # نفّذ + backup
  python3 scripts/data_engine_unify.py --apply --verbose

المتطلبات:
  - Python 3.11+
  - db/data_engine.db + db/stocks.db موجودين
  - scripts/repair_tab_symbols.py موجود

الـ DBs اللي بتتعدّل:
  - db/data_engine.db (tab_* tables)
  - db/stocks.db (ما بيتلمسش — بس verify)

ملاحظات:
  - idempotent: لو شُغل مرتين ما يضرش (الـ repair بـ skip الـ clean rows).
  - backup بيتعمل في db/backup-unify-<timestamp>/ (local، gitignored).
  - الـ script بـ يـ run relative لـ __file__ (Rule 17).
  - ما بـ pushش أي حاجة لـ GitHub (ده شغل DB محلي).

DATA-ENGINE-UNIFY-1 — جون (المدير التنفيذي)
=====================================================================
"""
from __future__ import annotations

import argparse
import json
import os
import shutil
import sqlite3
import subprocess
import sys
from datetime import datetime
from pathlib import Path

# Relative paths (Rule 17)
PROJECT_ROOT = Path(__file__).resolve().parents[1]
DATA_DIR = PROJECT_ROOT / "db"
DATA_ENGINE_DB = DATA_DIR / "data_engine.db"
STOCKS_DB = DATA_DIR / "stocks.db"
REPAIR_SCRIPT = PROJECT_ROOT / "scripts" / "repair_tab_symbols.py"

# tab_* tables الـ 8
TAB_TABLES = [
    "tab_valuation",
    "tab_profitability",
    "tab_technical_analysis",
    "tab_dividends",
    "tab_performance",
    "tab_balance_sheet",
    "tab_income_statement",
    "tab_cash_flow",
]

# Shifted rows = symbol = اسم سوق (مش ticker فعلي)
SHIFTED_MARKETS = ["السعودية", "مصر", "الكويت", "قطر"]


def log(msg: str, level: str = "INFO"):
    ts = datetime.now().strftime("%H:%M:%S")
    print(f"[{ts}] [{level}] {msg}")


def backup_dbs(backup_dir: Path):
    """نسخ احتياطي للـ DBs قبل أي تعديل."""
    backup_dir.mkdir(parents=True, exist_ok=True)
    timestamp = datetime.now().strftime("%Y%m%d_%H%M%S")

    backed_up = []
    for db_file in [DATA_ENGINE_DB, STOCKS_DB]:
        if db_file.exists():
            dst = backup_dir / f"{db_file.name}.{timestamp}"
            shutil.copy2(db_file, dst)
            backed_up.append(str(dst))
            log(f"  backup: {db_file.name} → {dst.name}")

    return backed_up


def count_polluted(db_path: Path, table: str) -> int:
    """عد الـ rows اللي symbol فيها فيه حروف عربية (pollution)."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=30.0)
        cnt = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE symbol GLOB '*[\u0600-\u06ff]*'"
        ).fetchone()[0]
        conn.close()
        return cnt
    except Exception:
        return -1


def count_shifted(db_path: Path, table: str) -> int:
    """عد الـ rows اللي symbol = اسم سوق (shifted)."""
    try:
        conn = sqlite3.connect(str(db_path), timeout=30.0)
        placeholders = ",".join([f"'{m}'" for m in SHIFTED_MARKETS])
        cnt = conn.execute(
            f"SELECT COUNT(*) FROM {table} WHERE symbol IN ({placeholders})"
        ).fetchone()[0]
        conn.close()
        return cnt
    except Exception:
        return -1


def run_repair(apply: bool, verbose: bool) -> dict:
    """شغل repair_tab_symbols.py."""
    if not REPAIR_SCRIPT.exists():
        log(f"  ❌ repair script not found: {REPAIR_SCRIPT}", "ERROR")
        return {"success": False, "error": "repair script not found"}

    cmd = [sys.executable, str(REPAIR_SCRIPT)]
    if apply:
        cmd.append("--apply")
    if verbose:
        log(f"  running: {' '.join(cmd)}")

    result = subprocess.run(cmd, capture_output=True, text=True, cwd=str(PROJECT_ROOT))
    if result.returncode != 0:
        log(f"  ❌ repair script failed (exit {result.returncode})", "ERROR")
        if verbose:
            log(f"  stderr: {result.stderr[:500]}", "ERROR")
        return {"success": False, "error": result.stderr[:500]}

    if verbose:
        log(f"  repair output (last 10 lines):")
        for line in result.stdout.strip().split("\n")[-10:]:
            print(f"    {line}")

    return {"success": True, "output": result.stdout[-1000:]}


def delete_shifted_rows(db_path: Path, apply: bool, verbose: bool) -> dict:
    """DELETE الـ shifted rows (symbol = اسم سوق)."""
    deleted = {}
    conn = sqlite3.connect(str(db_path), timeout=30.0)

    for table in TAB_TABLES:
        try:
            placeholders = ",".join([f"'{m}'" for m in SHIFTED_MARKETS])
            count = conn.execute(
                f"SELECT COUNT(*) FROM {table} WHERE symbol IN ({placeholders})"
            ).fetchone()[0]

            if count == 0:
                deleted[table] = 0
                continue

            if apply:
                conn.execute(
                    f"DELETE FROM {table} WHERE symbol IN ({placeholders})"
                )
                deleted[table] = count
                if verbose:
                    log(f"  {table}: deleted {count} shifted rows")
            else:
                deleted[table] = count
                if verbose:
                    log(f"  {table}: {count} shifted rows (dry-run — not deleted)")
        except Exception as e:
            deleted[table] = -1
            log(f"  ⚠️ {table}: error — {e}", "WARN")

    if apply:
        conn.commit()
    conn.close()
    return deleted


def verify_results() -> dict:
    """تحقق من النتائج النهائية."""
    results = {}
    for table in TAB_TABLES:
        polluted = count_polluted(DATA_ENGINE_DB, table)
        shifted = count_shifted(DATA_ENGINE_DB, table)
        total = -1
        try:
            conn = sqlite3.connect(str(DATA_ENGINE_DB), timeout=30.0)
            total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            conn.close()
        except Exception:
            pass
        results[table] = {
            "total": total,
            "polluted_remaining": polluted,
            "shifted_remaining": shifted,
            "clean": total - polluted - shifted if total > 0 else -1,
        }
    return results


def main():
    parser = argparse.ArgumentParser(
        description="DATA-ENGINE-UNIFY-1 — توحيد محرك البيانات"
    )
    parser.add_argument(
        "--apply",
        action="store_true",
        help="نفّذ التعديلات (default: dry-run)",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="تفاصيل أكتر",
    )
    args = parser.parse_args()

    log("=" * 60)
    log("DATA-ENGINE-UNIFY-1 — توحيد محرك البيانات")
    log(f"Mode: {'APPLY' if args.apply else 'DRY-RUN'}")
    log("=" * 60)

    # 0. تحقق من الـ DBs موجودة
    if not DATA_ENGINE_DB.exists():
        log(f"  ❌ {DATA_ENGINE_DB} not found", "ERROR")
        sys.exit(1)
    if not REPAIR_SCRIPT.exists():
        log(f"  ❌ {REPAIR_SCRIPT} not found", "ERROR")
        sys.exit(1)

    # 1. backup (لو apply)
    backup_dir = DATA_DIR / f"backup-unify-{datetime.now().strftime('%Y%m%d_%H%M%S')}"
    backed_up = []
    if args.apply:
        log("📋 Step 1: backup الـ DBs")
        backed_up = backup_dbs(backup_dir)
        if not backed_up:
            log("  ❌ backup failed", "ERROR")
            sys.exit(1)
    else:
        log("📋 Step 1: backup (skipped — dry-run)")

    # 2. قبل الإصلاح: عد الـ pollution
    log("\n📊 Step 2: عد الـ pollution قبل الإصلاح")
    before = {}
    for table in TAB_TABLES:
        polluted = count_polluted(DATA_ENGINE_DB, table)
        shifted = count_shifted(DATA_ENGINE_DB, table)
        before[table] = {"polluted": polluted, "shifted": shifted}
        if args.verbose or polluted > 0:
            log(f"  {table}: polluted={polluted}, shifted={shifted}")

    total_polluted_before = sum(v["polluted"] for v in before.values())
    total_shifted_before = sum(v["shifted"] for v in before.values())
    log(f"  📊 إجمالي قبل: {total_polluted_before} polluted + {total_shifted_before} shifted")

    # 3. شغل repair_tab_symbols.py
    log("\n🔧 Step 3: شغل repair_tab_symbols.py")
    repair_result = run_repair(args.apply, args.verbose)
    if not repair_result["success"]:
        log("  ❌ repair failed", "ERROR")
        sys.exit(1)

    # 4. DELETE الـ shifted rows
    log("\n🧹 Step 4: DELETE الـ shifted rows (symbol = اسم سوق)")
    deleted = delete_shifted_rows(DATA_ENGINE_DB, args.apply, args.verbose)
    total_deleted = sum(v for v in deleted.values() if v > 0)
    log(f"  📊 إجمالي shifted rows: {total_deleted}")

    # 5. verify
    log("\n✅ Step 5: verify النتائج")
    after = verify_results()
    total_polluted_after = sum(v["polluted_remaining"] for v in after.values())
    total_shifted_after = sum(v["shifted_remaining"] for v in after.values())
    log(f"  📊 إجمالي بعد: {total_polluted_after} polluted + {total_shifted_after} shifted")

    if total_polluted_after == 0 and total_shifted_after == 0:
        log("  ✅ كل الـ tab_* نضيفة!")
    else:
        log(f"  ⚠️ لسه فيه {total_polluted_after} polluted + {total_shifted_after} shifted", "WARN")

    # 6. report
    report = {
        "task": "DATA-ENGINE-UNIFY-1",
        "timestamp": datetime.now().isoformat(),
        "mode": "apply" if args.apply else "dry-run",
        "backups": backed_up,
        "before": before,
        "after": after,
        "repair_output": repair_result.get("output", ""),
        "shifted_deleted": deleted,
        "summary": {
            "total_polluted_before": total_polluted_before,
            "total_polluted_after": total_polluted_after,
            "total_shifted_before": total_shifted_before,
            "total_shifted_after": total_shifted_after,
            "total_repaired": total_polluted_before - total_polluted_after,
            "total_deleted": total_deleted if args.apply else 0,
        },
    }

    report_file = PROJECT_ROOT / "scripts" / "output" / f"data_engine_unify_{datetime.now().strftime('%Y%m%d_%H%M%S')}.json"
    report_file.parent.mkdir(parents=True, exist_ok=True)
    with open(report_file, "w", encoding="utf-8") as f:
        json.dump(report, f, indent=2, ensure_ascii=False, default=str)

    log(f"\n📄 Report: {report_file}")
    log("=" * 60)
    if args.apply:
        log(f"✅ APPLY خلص. {report['summary']['total_repaired']} repaired, {total_deleted} deleted.")
        log(f"   Backups in: {backup_dir}")
    else:
        log(f"📋 DRY-RUN خلص. شغّل بـ --apply للتنفيذ.")
    log("=" * 60)


if __name__ == "__main__":
    main()
