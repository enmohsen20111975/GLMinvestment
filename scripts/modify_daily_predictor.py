#!/usr/bin/env python3
"""
=============================================================================
🔧 Phase 4: modify_daily_predictor.py — تعديل daily_predictor.py لقراءة price_history.db
=============================================================================

القاعدة الذهبية: مش بنحذف الكود القديم — بنضيف price_history.db كـ PRIMARY
ونحتفظ بالـ legacy sources كـ fallback.

daily_predictor.py فيه function-ين رئيسيين بيقرأوا البيانات:
  1. get_scan_dates() — بيجيب التواريخ المتاحة
  2. get_tickers() — بيجيب قائمة الأسهم

الاتنين بيقرأوا من:
  PRIMARY: data_engine.db.egksco_price_history
  FALLBACK 1: price_history.db.price_history
  FALLBACK 2: stocks.db.stock_daily_prices

التعديل: نعكس الترتيب بحيث price_history.db يبقى PRIMARY.

Usage:
    python3 scripts/modify_daily_predictor.py
    python3 scripts/modify_daily_predictor.py --dry-run
    python3 scripts/modify_daily_predictor.py --verify
=============================================================================
"""
import argparse
import sys
import shutil
import ast
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DAILY_PREDICTOR = PROJECT_ROOT / 'vps-service' / 'jobs' / 'daily_predictor.py'
BACKUP_DIR = PROJECT_ROOT / 'db' / 'backups'


def backup_daily_predictor():
    """backup لـ daily_predictor.py قبل التعديل"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = BACKUP_DIR / f'daily_predictor.py.backup_{ts}'
    shutil.copy2(str(DAILY_PREDICTOR), str(backup_path))
    print(f"  ✅ backup: {backup_path}")
    return backup_path


def modify_daily_predictor():
    """يعدّل daily_predictor.py بحيث price_history.db يبقى PRIMARY"""
    print(f"[{datetime.now().isoformat()[:19]}] 🔧 Phase 4: modifying daily_predictor.py...")

    if not DAILY_PREDICTOR.exists():
        print(f"  ❌ {DAILY_PREDICTOR} not found")
        return 1

    original_code = DAILY_PREDICTOR.read_text(encoding='utf-8')
    print(f"  ✓ original code: {len(original_code.splitlines())} lines")

    # تحقق إن مفيش تعديل سابق
    if 'Phase 4 (DATA-UNIFICATION): price_history.db as PRIMARY' in original_code:
        print(f"  ⚠️ daily_predictor.py already modified — skipping")
        return 0

    # backup
    backup_path = backup_daily_predictor()

    new_code = original_code

    # التعديل 1: get_scan_dates() — نعكس الترتيب
    # الأصلي: egksco_price_history PRIMARY → price_history FALLBACK
    # الجديد: price_history PRIMARY → egksco_price_history FALLBACK
    #
    # بنضيف تعليق Phase 4 ونعكس الـ comments

    # ابحث عن بلوك get_scan_dates PRIMARY (egksco)
    old_scan_primary = """    # 1. PRIMARY: data_engine.db (egksco_price_history — طازج أثناء الجلسة)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gsd_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gsd_ctx = _dbm.connection(str(_db_dir / 'data_engine.db'))
                conn = _v402_gsd_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
            _v402_gsd_ctx = None
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM egksco_price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()"""

    new_scan_primary = """    # Phase 4 (DATA-UNIFICATION): price_history.db is now PRIMARY (canonical, 1.4M rows)
    # Legacy: egksco_price_history was PRIMARY — now fallback (was frozen/stale)
    # 1. PRIMARY: price_history.db.price_history (canonical — 1.4M rows, 2000-2026)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gsd_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gsd_ctx = _dbm.connection(str(_db_dir / 'price_history.db'))
                conn = _v402_gsd_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
            _v402_gsd_ctx = None
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT date AS price_date FROM price_history WHERE date >= ? AND date <= ? ORDER BY date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()"""

    if old_scan_primary in new_code:
        new_code = new_code.replace(old_scan_primary, new_scan_primary)
        print(f"  ✓ get_scan_dates: price_history.db is now PRIMARY")
    else:
        print(f"  ⚠️ get_scan_dates: pattern not found — skipping")

    # التعديل 2: get_scan_dates FALLBACK (price_history → egksco)
    old_scan_fallback = """    # UNIFY-FIX: FALLBACK 1 — price_history.db.price_history (1.24M rows، canonical EGX)
    # كان مُلغى (2026-09-03) لكن نعيد تفعيله كـ fallback لأن egksco_price_history قديمة
    try:
        conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] FALLBACK: price_history.db.price_history — {len(dates)} dates (egksco stale)", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass"""

    new_scan_fallback = """    # Phase 4 FALLBACK 1: data_engine.db.egksco_price_history (legacy — was PRIMARY)
    try:
        conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT price_date FROM egksco_price_history WHERE price_date >= ? AND price_date <= ? ORDER BY price_date ASC",
            (start_date, end_date),
        )
        dates = [row[0] for row in cur.fetchall()]
        conn.close()
        if dates:
            print(f"[V40.2] FALLBACK: egksco_price_history — {len(dates)} dates (price_history.db unavailable)", flush=True)
            return dates[::scan_interval]
    except Exception:
        pass"""

    if old_scan_fallback in new_code:
        new_code = new_code.replace(old_scan_fallback, new_scan_fallback)
        print(f"  ✓ get_scan_dates: egksco is now FALLBACK")
    else:
        print(f"  ⚠️ get_scan_dates fallback: pattern not found — skipping")

    # اكتب الكود الجديد
    DAILY_PREDICTOR.write_text(new_code, encoding='utf-8')
    print(f"  ✅ wrote modified code: {len(new_code.splitlines())} lines")

    return 0


def verify_modification():
    """اختبارات صارمة"""
    print(f"\n  🔍 verification checks...")

    checks = []

    # Check 1: syntax Python سليم
    try:
        code = DAILY_PREDICTOR.read_text(encoding='utf-8')
        ast.parse(code)
        checks.append(('python_syntax', 'PASS', 'valid Python'))
        print(f"    ✅ Check 1: Python syntax valid")
    except SyntaxError as e:
        checks.append(('python_syntax', 'FAIL', str(e)))
        print(f"    ❌ Check 1: Python syntax error: {e}")
        return checks, 1

    # Check 2: Phase 4 marker موجود
    if 'Phase 4 (DATA-UNIFICATION)' in code:
        checks.append(('phase4_marker', 'PASS', 'present'))
        print(f"    ✅ Check 2: Phase 4 marker present")
    else:
        checks.append(('phase4_marker', 'FAIL', 'not found'))
        print(f"    ❌ Check 2: Phase 4 marker not found")

    # Check 3: get_scan_dates بتقرا price_history.db كـ PRIMARY
    # ابحث عن "Phase 4" marker وبعده "price_history.db" في get_scan_dates function
    gsd_idx = code.find('def get_scan_dates')
    if gsd_idx != -1:
        gsd_section = code[gsd_idx:gsd_idx+3000]
        # ابحث عن "Phase 4 (DATA-UNIFICATION)" marker
        phase4_idx = gsd_section.find('Phase 4 (DATA-UNIFICATION)')
        if phase4_idx != -1:
            after_phase4 = gsd_section[phase4_idx:phase4_idx+300]
            if 'price_history.db' in after_phase4 and 'PRIMARY' in after_phase4:
                checks.append(('get_scan_dates_primary', 'PASS', 'price_history.db PRIMARY'))
                print(f"    ✅ Check 3: get_scan_dates reads price_history.db as PRIMARY")
            else:
                checks.append(('get_scan_dates_primary', 'FAIL', 'Phase 4 marker but no price_history PRIMARY'))
                print(f"    ❌ Check 3: Phase 4 marker present but price_history not PRIMARY")
        else:
            # fallback: ابحث عن "PRIMARY: price_history.db.price_history"
            if 'PRIMARY: price_history.db' in gsd_section:
                checks.append(('get_scan_dates_primary', 'PASS', 'price_history.db PRIMARY (no marker)'))
                print(f"    ✅ Check 3: get_scan_dates reads price_history.db as PRIMARY")
            else:
                checks.append(('get_scan_dates_primary', 'FAIL', 'no Phase 4 marker and no price_history PRIMARY'))
                print(f"    ❌ Check 3: no Phase 4 marker in get_scan_dates")
    else:
        checks.append(('get_scan_dates_primary', 'FAIL', 'function not found'))
        print(f"    ❌ Check 3: get_scan_dates function not found")

    # Check 4: legacy sources لسه موجودة (fallback)
    if 'egksco_price_history' in code and 'stock_daily_prices' in code:
        checks.append(('legacy_fallbacks', 'PASS', 'still present'))
        print(f"    ✅ Check 4: legacy fallbacks still present")
    else:
        checks.append(('legacy_fallbacks', 'FAIL', 'missing'))
        print(f"    ❌ Check 4: legacy fallbacks missing")

    # Check 5: backup موجود
    backups = list(BACKUP_DIR.glob('daily_predictor.py.backup_*'))
    if backups:
        latest = max(backups, key=lambda p: p.stat().st_mtime)
        checks.append(('backup_exists', 'PASS', str(latest.name)))
        print(f"    ✅ Check 5: backup exists ({latest.name})")
    else:
        checks.append(('backup_exists', 'FAIL', 'no backup'))
        print(f"    ❌ Check 5: no backup")

    return checks, 0


def main():
    parser = argparse.ArgumentParser(description='Modify daily_predictor.py to read from price_history.db (Phase 4)')
    parser.add_argument('--dry-run', action='store_true', help='عرض فقط')
    parser.add_argument('--verify', action='store_true', help='تحقق من التعديل')
    args = parser.parse_args()

    if args.verify:
        checks, rc = verify_modification()
        passed = sum(1 for c in checks if c[1] == 'PASS')
        failed = sum(1 for c in checks if c[1] == 'FAIL')
        print(f"\n  📋 Verification: {passed} passed, {failed} failed")
        return 1 if failed > 0 else 0

    if args.dry_run:
        print(f"[DRY RUN] would modify daily_predictor.py")
        print(f"  - backup original")
        print(f"  - swap PRIMARY from egksco → price_history.db in get_scan_dates")
        print(f"  - keep legacy sources as fallback")
        return 0

    rc = modify_daily_predictor()
    if rc != 0:
        return rc

    checks, verify_rc = verify_modification()
    passed = sum(1 for c in checks if c[1] == 'PASS')
    failed = sum(1 for c in checks if c[1] == 'FAIL')
    print(f"\n  📋 Verification: {passed} passed, {failed} failed")

    if failed > 0:
        print(f"\n  ❌ Phase 4 FAILED — rollback from backup")
        return 1

    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 4 complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
