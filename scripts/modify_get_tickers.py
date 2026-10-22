#!/usr/bin/env python3
"""
=============================================================================
🔧 Phase 5: modify_get_tickers.py — تعديل get_tickers() لقراءة price_history.db
=============================================================================

القاعدة الذهبية: مش بنحذف الكود القديم — بنضيف price_history.db كـ PRIMARY
ونحتفظ بالـ legacy sources كـ fallback.

get_tickers() في daily_predictor.py بيقرا من:
  PRIMARY: data_engine.db.egksco_price_history
  FALLBACK 1: price_history.db.price_history
  FALLBACK 2: stocks.db.stock_daily_prices

التعديل: نعكس الترتيب بحيث price_history.db يبقى PRIMARY.
الـ EGX-MARKET-ISOLATION gate بيشتغل على أي list of tickers → مش محتاج تعديل.

Usage:
    python3 scripts/modify_get_tickers.py
    python3 scripts/modify_get_tickers.py --dry-run
    python3 scripts/modify_get_tickers.py --verify
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
    backup_path = BACKUP_DIR / f'daily_predictor.py.backup_phase5_{ts}'
    shutil.copy2(str(DAILY_PREDICTOR), str(backup_path))
    print(f"  ✅ backup: {backup_path}")
    return backup_path


def modify_get_tickers():
    """يعدّل get_tickers() بحيث price_history.db يبقى PRIMARY"""
    print(f"[{datetime.now().isoformat()[:19]}] 🔧 Phase 5: modifying get_tickers()...")

    if not DAILY_PREDICTOR.exists():
        print(f"  ❌ {DAILY_PREDICTOR} not found")
        return 1

    original_code = DAILY_PREDICTOR.read_text(encoding='utf-8')
    print(f"  ✓ original code: {len(original_code.splitlines())} lines")

    # تحقق إن مفيش تعديل سابق
    if 'Phase 5 (DATA-UNIFICATION)' in original_code:
        print(f"  ⚠️ daily_predictor.py already modified for Phase 5 — skipping")
        return 0

    # backup
    backup_path = backup_daily_predictor()

    new_code = original_code

    # التعديل: نعكس الترتيب في get_tickers
    # الأصلي:
    #   1. PRIMARY: data_engine.db (egksco_price_history)
    #   2. FALLBACK: price_history.db (LEGACY)
    #   3. Fallback أخير: stocks.db (stock_daily_prices)
    #
    # الجديد:
    #   1. PRIMARY: price_history.db (Phase 5 — canonical)
    #   2. FALLBACK: data_engine.db (egksco_price_history — legacy)
    #   3. Fallback أخير: stocks.db (stock_daily_prices) — unchanged

    # ابحث عن بلوك PRIMARY الأصلي (egksco) في get_tickers
    # ونبدله بـ price_history PRIMARY
    old_primary = """    # 1. PRIMARY: data_engine.db (egksco_price_history — طازج أثناء الجلسة)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gt_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gt_ctx = _dbm.connection(str(_db_dir / 'data_engine.db'))
                conn = _v402_gt_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
            _v402_gt_ctx = None
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT symbol FROM egksco_price_history GROUP BY symbol HAVING COUNT(*) >= ? ORDER BY symbol",
            (min_days,),
        )
        raw_tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] data_engine.db (egksco) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
                print(f"[V40.2] Using data_engine.db (egksco) — {len(tickers)} tickers "
                      f"(⚠️ EGX gate not available — no filtering)", flush=True)
            return tickers
    except Exception:
        pass"""

    new_primary = """    # Phase 5 (DATA-UNIFICATION): price_history.db is now PRIMARY (canonical, 1.4M rows)
    # Legacy: egksco_price_history was PRIMARY — now fallback (was frozen/stale)
    # 1. PRIMARY: price_history.db.price_history (canonical — 1.4M rows, 1557 tickers)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gt_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gt_ctx = _dbm.connection(str(_db_dir / 'price_history.db'))
                conn = _v402_gt_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
            _v402_gt_ctx = None
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(price_history)")
        _ph_cols = [r[1] for r in cur.fetchall()]
        _ph_ticker_col = 'ticker' if 'ticker' in _ph_cols else ('symbol' if 'symbol' in _ph_cols else None)
        if _ph_ticker_col:
            cur.execute(
                f"SELECT DISTINCT {_ph_ticker_col} FROM price_history GROUP BY {_ph_ticker_col} HAVING COUNT(*) >= ? ORDER BY {_ph_ticker_col}",
                (min_days,),
            )
            raw_tickers = [row[0] for row in cur.fetchall()]
        else:
            raw_tickers = []
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] price_history.db ({_ph_ticker_col}) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
                print(f"[V40.2] Using price_history.db ({_ph_ticker_col}) — {len(tickers)} tickers "
                      f"(⚠️ EGX gate not available — no filtering)", flush=True)
            return tickers
    except Exception:
        pass"""

    if old_primary in new_code:
        new_code = new_code.replace(old_primary, new_primary)
        print(f"  ✓ get_tickers: price_history.db is now PRIMARY")
    else:
        print(f"  ⚠️ get_tickers PRIMARY pattern not found — skipping")
        return 1

    # التعديل 2: FALLBACK (price_history → egksco)
    old_fallback = """    # 2. FALLBACK: price_history.db (LEGACY — متجمد)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gt2_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gt2_ctx = _dbm.connection(str(_db_dir / 'price_history.db'))
                conn = _v402_gt2_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'price_history.db'), timeout=10.0)
            _v402_gt2_ctx = None
        cur = conn.cursor()
        cur.execute("PRAGMA table_info(price_history)")
        cols = [r[1] for r in cur.fetchall()]
        ticker_col = 'ticker' if 'ticker' in cols else 'symbol' if 'symbol' in cols else None
        if ticker_col:
            cur.execute(
                f"SELECT DISTINCT {ticker_col} FROM price_history GROUP BY {ticker_col} HAVING COUNT(*) >= ? ORDER BY {ticker_col}",
                (min_days,),
            )
            raw_tickers = [row[0] for row in cur.fetchall()]
            conn.close()
            if raw_tickers:
                # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
                if _egx_gate_available:
                    result = filter_egx_tickers_detailed(raw_tickers)
                    tickers = result['accepted']
                    stats = result['stats']
                    print(f"[V40.2] price_history.db ({ticker_col}) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
            return tickers
    except Exception:
        pass"""

    new_fallback = """    # Phase 5 FALLBACK 1: data_engine.db (egksco_price_history — legacy, was PRIMARY)
    try:
        # Rule 54 / Phase 3: استخدم db_manager — fallback sqlite3.connect
        _v402_gt2_ctx = None
        try:
            if _V402_DBM_AVAILABLE:
                _v402_gt2_ctx = _dbm.connection(str(_db_dir / 'data_engine.db'))
                conn = _v402_gt2_ctx.__enter__()
            else:
                raise RuntimeError("db_manager unavailable")
        except Exception:
            conn = sqlite3.connect(str(_db_dir / 'data_engine.db'), timeout=10.0)
            _v402_gt2_ctx = None
        cur = conn.cursor()
        cur.execute(
            "SELECT DISTINCT symbol FROM egksco_price_history GROUP BY symbol HAVING COUNT(*) >= ? ORDER BY symbol",
            (min_days,),
        )
        raw_tickers = [row[0] for row in cur.fetchall()]
        conn.close()
        if raw_tickers:
            # EGX-MARKET-ISOLATION: فلتر EGX canonical فقط
            if _egx_gate_available:
                result = filter_egx_tickers_detailed(raw_tickers)
                tickers = result['accepted']
                stats = result['stats']
                print(f"[V40.2] FALLBACK: data_engine.db (egksco) — {len(raw_tickers)} raw → "
                      f"{len(tickers)} EGX-canonical "
                      f"(rejected {stats['rejected_count']} non-EGX, "
                      f"removed {stats['duplicates_removed']} dups)", flush=True)
            else:
                tickers = raw_tickers
            return tickers
    except Exception:
        pass"""

    if old_fallback in new_code:
        new_code = new_code.replace(old_fallback, new_fallback)
        print(f"  ✓ get_tickers: egksco is now FALLBACK")
    else:
        print(f"  ⚠️ get_tickers FALLBACK pattern not found — skipping")

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

    # Check 2: Phase 5 marker موجود
    if 'Phase 5 (DATA-UNIFICATION)' in code:
        checks.append(('phase5_marker', 'PASS', 'present'))
        print(f"    ✅ Check 2: Phase 5 marker present")
    else:
        checks.append(('phase5_marker', 'FAIL', 'not found'))
        print(f"    ❌ Check 2: Phase 5 marker not found")

    # Check 3: get_tickers بتقرا price_history.db كـ PRIMARY
    gt_idx = code.find('def get_tickers')
    if gt_idx != -1:
        gt_section = code[gt_idx:gt_idx+4000]
        phase5_idx = gt_section.find('Phase 5 (DATA-UNIFICATION)')
        if phase5_idx != -1:
            after_phase5 = gt_section[phase5_idx:phase5_idx+400]
            if 'price_history.db' in after_phase5 and 'PRIMARY' in after_phase5:
                checks.append(('get_tickers_primary', 'PASS', 'price_history.db PRIMARY'))
                print(f"    ✅ Check 3: get_tickers reads price_history.db as PRIMARY")
            else:
                checks.append(('get_tickers_primary', 'FAIL', 'Phase 5 marker but no price_history PRIMARY'))
                print(f"    ❌ Check 3: Phase 5 marker present but price_history not PRIMARY")
        else:
            checks.append(('get_tickers_primary', 'FAIL', 'no Phase 5 marker in get_tickers'))
            print(f"    ❌ Check 3: no Phase 5 marker in get_tickers")
    else:
        checks.append(('get_tickers_primary', 'FAIL', 'function not found'))
        print(f"    ❌ Check 3: get_tickers function not found")

    # Check 4: legacy sources لسه موجودة (fallback)
    if 'egksco_price_history' in code and 'stock_daily_prices' in code:
        checks.append(('legacy_fallbacks', 'PASS', 'still present'))
        print(f"    ✅ Check 4: legacy fallbacks still present")
    else:
        checks.append(('legacy_fallbacks', 'FAIL', 'missing'))
        print(f"    ❌ Check 4: legacy fallbacks missing")

    # Check 5: EGX gate لسه موجود
    if 'filter_egx_tickers_detailed' in code:
        checks.append(('egx_gate', 'PASS', 'still present'))
        print(f"    ✅ Check 5: EGX gate filter still present")
    else:
        checks.append(('egx_gate', 'FAIL', 'missing'))
        print(f"    ❌ Check 5: EGX gate filter missing")

    # Check 6: backup موجود
    backups = list(BACKUP_DIR.glob('daily_predictor.py.backup_phase5_*'))
    if backups:
        latest = max(backups, key=lambda p: p.stat().st_mtime)
        checks.append(('backup_exists', 'PASS', str(latest.name)))
        print(f"    ✅ Check 6: backup exists ({latest.name})")
    else:
        checks.append(('backup_exists', 'FAIL', 'no backup'))
        print(f"    ❌ Check 6: no backup")

    return checks, 0


def main():
    parser = argparse.ArgumentParser(description='Modify get_tickers() to read from price_history.db (Phase 5)')
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
        print(f"[DRY RUN] would modify get_tickers() in daily_predictor.py")
        print(f"  - backup original (phase5 backup)")
        print(f"  - swap PRIMARY from egksco → price_history.db in get_tickers")
        print(f"  - keep egksco as FALLBACK 1")
        print(f"  - keep EGX gate filter")
        return 0

    rc = modify_get_tickers()
    if rc != 0:
        return rc

    checks, verify_rc = verify_modification()
    passed = sum(1 for c in checks if c[1] == 'PASS')
    failed = sum(1 for c in checks if c[1] == 'FAIL')
    print(f"\n  📋 Verification: {passed} passed, {failed} failed")

    if failed > 0:
        print(f"\n  ❌ Phase 5 FAILED — rollback from backup")
        return 1

    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 5 complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
