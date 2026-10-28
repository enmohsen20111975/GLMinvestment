#!/usr/bin/env python3
"""
check_raw_sqlite.py — lint rule: ممنوع sqlite3.connect خارج db_manager.py
========================================================================
شغّل ده قبل أي commit عشان تتأكد إن مفيش ملف جديد بيفتح sqlite3.connect.

Usage:
    python3 scripts/check_raw_sqlite.py
    python3 scripts/check_raw_sqlite.py --fix  (مش شغّال دلوقتي — بس تقرير)
"""
import os
import sys
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
VPS_SERVICE = PROJECT_ROOT / 'vps-service'

# ملفات مسموح ليها تستخدم sqlite3.connect (الـ DAL نفسه + fallbacks)
ALLOWED_FILES = {
    'core/db_manager.py',        # الـ DAL نفسه
    'core/database.py',          # الـ legacy DAL (backward compat)
    'core/db_helpers.py',        # helpers للـ DAL
    'core/migrator.py',          # migration scripts
    'utils/db_paths.py',         # path resolution
}

# ملفات معروفة بتعمل fallback pattern (محتاجة migration يدوي)
KNOWN_OFFENDERS = [
    'jobs/predictor_modules/scan_dates.py',
    'jobs/predictor_modules/cleanup.py',
    'analyzers/prediction_tracker.py',
    'analyzers/backtest_engine.py',
    'analyzers/prediction_optimizer.py',
    'analyzers/confluence_engine_v3.py',
    'analyzers/stock_dna_analyzer.py',
    'analyzers/market_regime_engine.py',
    'ai/trade_recorder.py',
    'ai/telegram_signal_importer.py',
    'jobs/daily_predictor.py',
    'jobs/market_scheduler.py',
    'jobs/daily_closer.py',
    'jobs/intraday_scanner.py',
    'jobs/crypto_lab_scheduler.py',
    'jobs/hot_candidate_detector.py',
    'jobs/price_history_stale_monitor.py',
    'jobs/daily_portfolio_yield.py',
    'jobs/fetch_corporate_actions.py',
    'jobs/wal_checkpoint.py',
    'api/portfolio_routes.py',
    'api/news_routes.py',
    'api/misc_routes.py',
    'lightweight_server.py',
    'core/price_sanity.py',
]


def check_file(filepath: Path) -> list:
    """فحص ملف واحد — ارجع قائمة بالـ violations."""
    rel_path = str(filepath.relative_to(VPS_SERVICE))
    
    # لو الملف مسموح له، اعدي
    if rel_path in ALLOWED_FILES:
        return []
    
    violations = []
    try:
        with open(filepath, 'r', encoding='utf-8') as f:
            for i, line in enumerate(f, 1):
                stripped = line.strip()
                # تجاهل comments
                if stripped.startswith('#'):
                    continue
                # ابحث عن sqlite3.connect
                if 'sqlite3.connect' in line:
                    violations.append({
                        'file': rel_path,
                        'line': i,
                        'code': stripped[:100],
                    })
    except Exception:
        pass
    return violations


def main():
    print('=' * 60)
    print('  Lint: ممنوع sqlite3.connect خارج db_manager.py')
    print('=' * 60)
    
    all_violations = []
    files_checked = 0
    
    for root, dirs, files in os.walk(VPS_SERVICE):
        # skip __pycache__, tests, archive
        dirs[:] = [d for d in dirs if d not in ('__pycache__', 'tests', 'archive', 'backtest_results')]
        
        for f in files:
            if not f.endswith('.py'):
                continue
            filepath = Path(root) / f
            files_checked += 1
            violations = check_file(filepath)
            all_violations.extend(violations)
    
    print(f'\n  Files checked: {files_checked}')
    print(f'  Violations: {len(all_violations)}')
    
    if all_violations:
        print(f'\n  ❌ ملفات بتستخدم sqlite3.connect مباشرة:')
        for v in all_violations[:20]:
            print(f'    {v["file"]}:{v["line"]} → {v["code"]}')
        if len(all_violations) > 20:
            print(f'    ... و {len(all_violations) - 20} violations تانية')
        
        # عدّ الـ known vs unknown
        known = sum(1 for v in all_violations if v['file'] in KNOWN_OFFENDERS)
        unknown = len(all_violations) - known
        print(f'\n  Known offenders: {known}')
        print(f'  Unknown (new!): {unknown}')
        
        if unknown > 0:
            print(f'\n  ⚠️  فيه {unknown} violations جديدة — لازم تتبص!')
            unknown_violations = [v for v in all_violations if v['file'] not in KNOWN_OFFENDERS]
            for v in unknown_violations:
                print(f'    {v["file"]}:{v["line"]} → {v["code"]}')
        
        sys.exit(1)
    else:
        print('\n  ✅ كل الملفات بتستخدم db_manager — مفيش sqlite3.connect مباشرة!')
        sys.exit(0)


if __name__ == '__main__':
    main()
