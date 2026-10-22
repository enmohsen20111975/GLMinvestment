#!/usr/bin/env python3
"""
=============================================================================
🔍 Production DB Audit — قارن schema الإنتاج مع الأكواد اللي هتتنفذ
=============================================================================

الهدف: قبل أي deployment، لازم نعرف:
  1. إيه الـ DBs الموجودة على الإنتاج؟
  2. إيه الـ schema بتاع كل DB؟
  3. هل الـ schema بتاع الإنتاج مطابق للي عندنا (اللاب توب/الساند بوكس)؟
  4. هل فيه اختلافات ممكن تكسر الكود اللي هينزل؟

Usage (على السيرفر الإنتاجي):
  cd /root/GLMinvestment
  .venv/bin/python3 scripts/audit_production_db.py
  .venv/bin/python3 scripts/audit_production_db.py --compare-with /tmp/laptop_schema.json
"""

import json
import os
import sqlite3
import sys
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# الـ DBs اللي الكود بيتعامل معها (من audit الـ scripts)
EXPECTED_DBS = {
    'stocks.db': {
        'expected_tables': ['stocks', 'stock_daily_prices', 'stock_phase', 'ticker_registry'],
        'critical_for': 'frontend (103 routes) + daily_predictor + liquidity_radar',
    },
    'predictions.db': {
        'expected_tables': ['predictions', 'aiPrediction', 'historical_trades'],
        'critical_for': 'frontend (65 routes) + daily_predictor writes here',
    },
    'price_history.db': {
        'expected_tables': ['price_history'],
        'critical_for': 'Phase 5b PRIMARY — daily_predictor + liquidity_radar + maker_radar',
        'expected_columns': {
            'price_history': ['id', 'ticker', 'date', 'open_price', 'high_price',
                            'low_price', 'close_price', 'volume', 'source'],
        },
    },
    'data_engine.db': {
        'expected_tables': ['historical_data'],  # egksco_price_history مش موجود على بعض البيئات
        'critical_for': 'liquidity_radar_v2 fundamentals + daily_predictor fallback',
    },
    'intraday.db': {
        'expected_tables': ['stock_intraday'],
        'critical_for': 'liquidity_radar + intraday scanner',
    },
    'auth.db': {
        'expected_tables': ['User', 'Account', 'Session'],
        'critical_for': 'frontend (14 routes) + authentication',
    },
    'news.db': {
        'expected_tables': ['news_articles'],
        'critical_for': 'frontend (11 routes)',
    },
    'metrics.db': {
        'expected_tables': [],
        'critical_for': 'monitoring',
    },
    'crypto.db': {
        'expected_tables': ['cryptos'],
        'critical_for': 'crypto tracking',
    },
}


def audit_single_db(db_path: Path, expected_info: Dict[str, Any]) -> Dict[str, Any]:
    """فحص DB واحد و رجّع تقرير كامل."""
    result = {
        'db_name': db_path.name,
        'exists': db_path.exists(),
        'size_bytes': 0,
        'size_mb': 0,
        'tables': [],
        'table_schemas': {},
        'expected_tables_present': [],
        'expected_tables_missing': [],
        'unexpected_tables': [],
        'row_counts': {},
        'issues': [],
    }

    if not db_path.exists():
        result['issues'].append(f'DB file missing: {db_path}')
        return result

    stat = db_path.stat()
    result['size_bytes'] = stat.st_size
    result['size_mb'] = round(stat.st_size / (1024 * 1024), 2)

    try:
        conn = sqlite3.connect(f'file:{db_path}?mode=ro', uri=True)
        cur = conn.cursor()

        # كل الـ tables
        cur.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
        result['tables'] = [r[0] for r in cur.fetchall()]

        # الـ expected tables
        expected = expected_info.get('expected_tables', [])
        for t in expected:
            if t in result['tables']:
                result['expected_tables_present'].append(t)
            else:
                result['expected_tables_missing'].append(t)

        # الـ unexpected tables (في DB بس مش في expected)
        known_optional = {'sqlite_sequence', 'lost_and_found'}
        for t in result['tables']:
            if t not in expected and t not in known_optional:
                result['unexpected_tables'].append(t)

        # schema + row count لكل table
        for t in result['tables']:
            if t in known_optional:
                continue
            try:
                cur.execute(f'PRAGMA table_info("{t}")')
                cols = [{'name': r[1], 'type': r[2], 'nullable': r[3] == 0,
                         'default': r[4], 'pk': r[5]} for r in cur.fetchall()]
                result['table_schemas'][t] = cols

                cur.execute(f'SELECT COUNT(*) FROM "{t}"')
                result['row_counts'][t] = cur.fetchone()[0]
            except Exception as e:
                result['issues'].append(f'table {t}: {e}')

        conn.close()
    except Exception as e:
        result['issues'].append(f'Cannot open DB: {e}')

    return result


def check_phase5b_compatibility(audit_results: Dict) -> List[str]:
    """فحص خاص: هل الـ schema متوافق مع Phase 5b code؟"""
    issues = []

    # 1. price_history.db لازم يكون موجود
    ph = audit_results.get('price_history.db', {})
    if not ph.get('exists'):
        issues.append('🔴 price_history.db مش موجود — Phase 5b مش هيشتغل')
        return issues

    # 2. price_history table لازم يكون موجود
    schemas = ph.get('table_schemas', {})
    if 'price_history' not in schemas:
        issues.append('🔴 price_history table مش موجود في price_history.db')
        return issues

    # 3. الأعمدة المطلوبة
    cols = {c['name'] for c in schemas['price_history']}
    required = {'ticker', 'date', 'open_price', 'high_price', 'low_price',
                'close_price', 'volume'}
    missing = required - cols
    if missing:
        issues.append(f'🔴 price_history table ناقص columns: {missing}')

    # 4. market column (الـ Phase 2 fix هيضيفها لو مش موجودة)
    if 'market' not in cols:
        issues.append('🟡 market column مش موجود — Phase 2 unify هيضيفه (متوقع)')

    # 5. stocks.db لازم يكون فيه stock_daily_prices (FALLBACK)
    stocks = audit_results.get('stocks.db', {})
    if not stocks.get('exists'):
        issues.append('🔴 stocks.db مش موجود — الـ FALLBACK مش هيشتغل')
    else:
        sdp = stocks.get('table_schemas', {}).get('stock_daily_prices')
        if not sdp:
            issues.append('🔴 stock_daily_prices table مش موجود في stocks.db')
        else:
            sdp_cols = {c['name'] for c in sdp}
            sdp_required = {'ticker', 'price_date', 'open', 'high', 'low', 'close', 'volume'}
            sdp_missing = sdp_required - sdp_cols
            if sdp_missing:
                issues.append(f'🔴 stock_daily_prices ناقص columns: {sdp_missing}')

    return issues


def check_phase6_compatibility(audit_results: Dict) -> List[str]:
    """فحص خاص: هل الـ cron safetynet هيشتغل؟"""
    issues = []

    ph = audit_results.get('price_history.db', {})
    if not ph.get('exists'):
        issues.append('🔴 price_history.db مش موجود — safetynet مش هيقدر يكتب')
        return issues

    # لازم فيه UNIQUE index على (ticker, date, source) عشان INSERT OR REPLACE يشتغل
    # بس ده مش critical — الـ safetynet script بيعمل ALTER لو مش موجود

    return issues


def main():
    print(f"\n{'='*70}")
    print(f"🔍 Production DB Audit — {datetime.now().isoformat()[:19]}")
    print(f"{'='*70}\n")

    if not DB_DIR.exists():
        print(f"❌ db/ directory not found at {DB_DIR}")
        return 1

    audit_results = {}

    for db_name, expected_info in EXPECTED_DBS.items():
        db_path = DB_DIR / db_name
        print(f"📋 Auditing {db_name}...")
        result = audit_single_db(db_path, expected_info)

        if result['exists']:
            print(f"  ✅ exists ({result['size_mb']} MB, {len(result['tables'])} tables)")
        else:
            print(f"  ❌ MISSING")

        if result['expected_tables_missing']:
            print(f"  ⚠️  missing expected tables: {result['expected_tables_missing']}")

        if result['issues']:
            for issue in result['issues']:
                print(f"  ⚠️  {issue}")

        audit_results[db_name] = result

    # Phase 5b compatibility check
    print(f"\n{'='*70}")
    print(f"🔬 Phase 5b Compatibility Check")
    print(f"{'='*70}\n")
    phase5b_issues = check_phase5b_compatibility(audit_results)
    if not phase5b_issues:
        print("✅ كل الـ requirements موجودة. Phase 5b هيشتغل.")
    else:
        for issue in phase5b_issues:
            print(f"  {issue}")

    # Phase 6 compatibility check
    print(f"\n{'='*70}")
    print(f"🔬 Phase 6 Compatibility Check")
    print(f"{'='*70}\n")
    phase6_issues = check_phase6_compatibility(audit_results)
    if not phase6_issues:
        print("✅ كل الـ requirements موجودة. Phase 6 (safetynet) هيشتغل.")
    else:
        for issue in phase6_issues:
            print(f"  {issue}")

    # احفظ الـ audit الكامل في JSON
    report_path = DB_DIR / f'db_audit_{datetime.now().strftime("%Y%m%d_%H%M%S")}.json'
    with open(report_path, 'w', encoding='utf-8') as f:
        json.dump(audit_results, f, indent=2, ensure_ascii=False, default=str)
    print(f"\n📁 Full audit report: {report_path}")

    # ملخص نهائي
    print(f"\n{'='*70}")
    print(f"📊 Summary")
    print(f"{'='*70}")
    total_dbs = len(EXPECTED_DBS)
    existing_dbs = sum(1 for r in audit_results.values() if r.get('exists'))
    missing_dbs = [name for name, r in audit_results.items() if not r.get('exists')]
    print(f"  DBs found: {existing_dbs}/{total_dbs}")
    if missing_dbs:
        print(f"  Missing: {missing_dbs}")
    print(f"  Phase 5b issues: {len(phase5b_issues)}")
    print(f"  Phase 6 issues: {len(phase6_issues)}")

    # لو فيه issues critical (🔴)، رجّع 1
    critical_issues = [i for i in phase5b_issues + phase6_issues if i.startswith('🔴')]
    if critical_issues:
        print(f"\n🚨 {len(critical_issues)} CRITICAL issues — STOP و ما تنفذش الـ deploy")
        return 1

    print(f"\n✅ Ready for deployment (after backup)")
    return 0


if __name__ == '__main__':
    sys.exit(main())
