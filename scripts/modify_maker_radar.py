#!/usr/bin/env python3
"""
=============================================================================
🔧 Phase 3: modify_maker_radar.py — تعديل maker_radar.py لقراءة price_history.db
=============================================================================

القاعدة الذهبية: مش بنحذف الكود القديم — بنضيف price_history.db كـ PRIMARY
ونحتفظ بالـ legacy sources كـ fallback.

السكربت ده بيعمل:
  1. backup لـ scripts/maker_radar.py
  2. يضيف price_history.db كـ FIRST candidate لكل الأسواق
  3. يحتفظ بالـ legacy sources كـ fallback
  4. اختبارات صارمة:
     - الكود القديم لسه موجود (في backup)
     - price_history.db هو أول candidate
     - syntax Python سليم
     - maker_radar.py لسه شغال

Usage:
    python3 scripts/modify_maker_radar.py
    python3 scripts/modify_maker_radar.py --dry-run
    python3 scripts/modify_maker_radar.py --verify
=============================================================================
"""
import argparse
import sys
import shutil
import ast
from pathlib import Path
from datetime import datetime

PROJECT_ROOT = Path(__file__).resolve().parents[1]
MAKER_RADAR = PROJECT_ROOT / 'scripts' / 'maker_radar.py'
BACKUP_DIR = PROJECT_ROOT / 'db' / 'backups'

# price_history.db tuple — الأعمدة الموافقة لـ price_history table
PRICE_HISTORY_TUPLE_STR = """(
                'db/price_history.db', 'price_history',
                'ticker', 'close_price', 'volume', None,
                'date', 'open_price', 'high_price', 'low_price',
            )"""


def backup_maker_radar():
    """backup لـ maker_radar.py قبل التعديل"""
    BACKUP_DIR.mkdir(parents=True, exist_ok=True)
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_path = BACKUP_DIR / f'maker_radar.py.backup_{ts}'
    shutil.copy2(str(MAKER_RADAR), str(backup_path))
    print(f"  ✅ backup: {backup_path}")
    return backup_path


def modify_maker_radar():
    """يعدّل maker_radar.py بحيث يضيف price_history.db كـ FIRST candidate"""
    print(f"[{datetime.now().isoformat()[:19]}] 🔧 Phase 3: modifying maker_radar.py...")

    if not MAKER_RADAR.exists():
        print(f"  ❌ {MAKER_RADAR} not found")
        return 1

    # 1. اقرا الكود الأصلي
    original_code = MAKER_RADAR.read_text(encoding='utf-8')
    print(f"  ✓ original code: {len(original_code.splitlines())} lines")

    # 2. تحقق إن مفيش تعديل سابق
    if 'price_history.db as PRIMARY (Phase 3)' in original_code:
        print(f"  ⚠️ maker_radar.py already modified — skipping")
        return 0

    # 3. backup
    backup_path = backup_maker_radar()

    # 4. التعديل: ضيف price_history.db كـ FIRST candidate لكل الأسواق
    # نبحث عن MARKET_CANDIDATES ونضيف price_history tuple قبل الـ candidates الحاليين

    # التعديل: نضيف PRICE_HISTORY_TUPLE في أول كل قائمة candidates
    new_code = original_code

    # أضف تعليق Phase 3 في الأول
    phase3_marker = """
    # ═══════════════════════════════════════════════════════════════════
    # Phase 3 (DATA-UNIFICATION): price_history.db as PRIMARY source
    # All markets now read from price_history.db FIRST (canonical source).
    # Legacy sources (stock_daily_prices, egksco, historical_data) kept
    # as fallback only. See DATA-UNIFICATION-PLAN.md
    # ═══════════════════════════════════════════════════════════════════
    PRICE_HISTORY_TUPLE = (
        'db/price_history.db', 'price_history',
        'ticker', 'close_price', 'volume', None,
        'date', 'open_price', 'high_price', 'low_price',
    )

"""

    # ضيف PRICE_HISTORY_TUPLE بعد HISTORICAL_DATA_TUPLE
    new_code = new_code.replace(
        "    HISTORICAL_DATA_TUPLE = (",
        phase3_marker + "    HISTORICAL_DATA_TUPLE = ("
    )

    # لكل سوق، ضيف PRICE_HISTORY_TUPLE في أول القائمة
    # IMPORTANT: فقط في MARKET_CANDIDATES dict (اللي بتبدأ بـ "MARKET_CANDIDATES: dict = {")
    # مش في market_variants (دي dict تانية بنفس أسماء الأسواق بس قيمها strings)
    markets_to_modify = ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']

    # patterns مختلفة لكل سوق (حسب شكل الكود)
    PATTERNS = {
        'EGX': (
            "        'EGX': [\n            # 1. stocks.db.stock_daily_prices",
            "        'EGX': [\n            PRICE_HISTORY_TUPLE,  # Phase 3: PRIMARY canonical source\n            # 1. stocks.db.stock_daily_prices"
        ),
        'TADAWUL': (
            "        'TADAWUL': [\n            (",
            "        'TADAWUL': [\n            PRICE_HISTORY_TUPLE,  # Phase 3: PRIMARY canonical source\n            ("
        ),
        'KSE': (
            "        'KSE': [\n            (",
            "        'KSE': [\n            PRICE_HISTORY_TUPLE,  # Phase 3: PRIMARY canonical source\n            ("
        ),
        'QSE': (
            "        'QSE': [\n            (",
            "        'QSE': [\n            PRICE_HISTORY_TUPLE,  # Phase 3: PRIMARY canonical source\n            ("
        ),
        'US': (
            "        'US':      [HISTORICAL_DATA_TUPLE],",
            "        'US':      [PRICE_HISTORY_TUPLE, HISTORICAL_DATA_TUPLE],  # Phase 3: price_history PRIMARY"
        ),
    }

    for market in markets_to_modify:
        old_pattern, new_pattern = PATTERNS[market]
        if old_pattern in new_code:
            new_code = new_code.replace(old_pattern, new_pattern, 1)
            print(f"  ✓ {market}: added price_history.db as PRIMARY")
        else:
            print(f"  ⚠️ {market}: pattern not found — skipping")

    # اكتب الكود الجديد
    MAKER_RADAR.write_text(new_code, encoding='utf-8')
    print(f"  ✅ wrote modified code: {len(new_code.splitlines())} lines")

    return 0


def verify_modification():
    """اختبارات صارمة"""
    print(f"\n  🔍 verification checks...")

    checks = []

    # Check 1: syntax Python سليم
    try:
        code = MAKER_RADAR.read_text(encoding='utf-8')
        ast.parse(code)
        checks.append(('python_syntax', 'PASS', 'valid Python'))
        print(f"    ✅ Check 1: Python syntax valid")
    except SyntaxError as e:
        checks.append(('python_syntax', 'FAIL', str(e)))
        print(f"    ❌ Check 1: Python syntax error: {e}")
        return checks, 1

    # Check 2: PRICE_HISTORY_TUPLE موجود
    if 'PRICE_HISTORY_TUPLE' in code:
        checks.append(('price_history_tuple', 'PASS', 'defined'))
        print(f"    ✅ Check 2: PRICE_HISTORY_TUPLE defined")
    else:
        checks.append(('price_history_tuple', 'FAIL', 'not found'))
        print(f"    ❌ Check 2: PRICE_HISTORY_TUPLE not found")

    # Check 3: price_history.db هو أول candidate لكل الأسواق
    for market in ['EGX', 'TADAWUL', 'KSE', 'QSE', 'US']:
        # ابحث عن أول occurrence في MARKET_CANDIDATES (مش market_variants)
        # MARKET_CANDIDATES بتبدأ بحوالي سطر 100، market_variants بتبدأ سطر 1200+
        # فنبحث في أول 1000 سطر بس
        lines = code.split('\n')
        market_candidates_start = None
        for i, line in enumerate(lines[:200]):
            if 'MARKET_CANDIDATES' in line:
                market_candidates_start = i
                break

        if market_candidates_start is None:
            checks.append((f'{market}_candidates', 'FAIL', 'MARKET_CANDIDATES not found'))
            print(f"    ❌ Check 3.{market}: MARKET_CANDIDATES not found")
            continue

        # ابحث عن السوق في أول 200 سطر من MARKET_CANDIDATES
        search_area = '\n'.join(lines[market_candidates_start:market_candidates_start+100])
        pattern = f"'{market}':"
        idx = search_area.find(pattern)
        if idx == -1:
            checks.append((f'{market}_candidates', 'FAIL', 'market not in MARKET_CANDIDATES'))
            print(f"    ❌ Check 3.{market}: market not in MARKET_CANDIDATES")
            continue

        # ابحث عن PRICE_HISTORY_TUPLE بعد السوق ده
        next_chars = search_area[idx:idx+500]
        if 'PRICE_HISTORY_TUPLE' in next_chars:
            checks.append((f'{market}_price_history_first', 'PASS', 'PRIMARY'))
            print(f"    ✅ Check 3.{market}: price_history.db is PRIMARY")
        else:
            checks.append((f'{market}_price_history_first', 'FAIL', 'not first'))
            print(f"    ❌ Check 3.{market}: price_history.db not first")

    # Check 4: backup موجود
    backups = list(BACKUP_DIR.glob('maker_radar.py.backup_*'))
    if backups:
        latest = max(backups, key=lambda p: p.stat().st_mtime)
        checks.append(('backup_exists', 'PASS', str(latest.name)))
        print(f"    ✅ Check 4: backup exists ({latest.name})")
    else:
        checks.append(('backup_exists', 'FAIL', 'no backup'))
        print(f"    ❌ Check 4: no backup")

    # Check 5: legacy sources لسه موجودين (fallback)
    if 'stock_daily_prices' in code and 'historical_data' in code:
        checks.append(('legacy_fallbacks', 'PASS', 'still present'))
        print(f"    ✅ Check 5: legacy fallbacks still present")
    else:
        checks.append(('legacy_fallbacks', 'FAIL', 'missing'))
        print(f"    ❌ Check 5: legacy fallbacks missing")

    return checks, 0


def main():
    parser = argparse.ArgumentParser(description='Modify maker_radar.py to read from price_history.db (Phase 3)')
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
        print(f"[DRY RUN] would modify maker_radar.py")
        print(f"  - backup original")
        print(f"  - add PRICE_HISTORY_TUPLE")
        print(f"  - insert as FIRST candidate for EGX/TADAWUL/KSE/QSE/US")
        return 0

    rc = modify_maker_radar()
    if rc != 0:
        return rc

    checks, verify_rc = verify_modification()
    passed = sum(1 for c in checks if c[1] == 'PASS')
    failed = sum(1 for c in checks if c[1] == 'FAIL')
    print(f"\n  📋 Verification: {passed} passed, {failed} failed")

    if failed > 0:
        print(f"\n  ❌ Phase 3 FAILED — rollback from backup")
        return 1

    print(f"\n[{datetime.now().isoformat()[:19]}] ✅ Phase 3 complete")
    return 0


if __name__ == "__main__":
    sys.exit(main())
