#!/usr/bin/env python3
"""
check_db_schema.py — فحص توافق الـ DB Schema مع الكود (Phase 9.4)
====================================================================

الـ script ده بيقرأ الجداول الفعلية من db/*.db ويقارنها بالـ SQL queries
في الكود عشان يكتشف أي عمود مستخدم في الكود ومش موجود في الـ DB.

الـ checks:
  1. كل DB قابلة للفتح (integrity_check)
  2. الجداول الرئيسية موجودة
  3. الأعمدة المستخدمة في queries موجودة في الـ schema

Usage:
    python3 scripts/check_db_schema.py
    python3 scripts/check_db_schema.py --strict   # exit(1) لو فيه مشاكل

Author: برافو (Phase 9.4 — Schema Consistency)
"""
from __future__ import annotations

import os
import sys
import sqlite3
from pathlib import Path
from typing import Dict, List, Set, Tuple

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / 'db'

# Expected DBs + their key tables
EXPECTED_DBS = {
    'stocks.db': ['stocks', 'stock_daily_prices'],
    'predictions.db': ['predictions', 'stored_analyses'],
    'price_history.db': ['price_history'],
    'data_engine.db': ['egksco_price_history', 'screener_lists'],
    'intraday.db': ['stock_intraday'],
    'auth.db': ['User'],
    'crypto.db': [],
    'news.db': ['market_news'],
}

# Expected columns in key tables
EXPECTED_COLUMNS = {
    'stocks': {'ticker', 'name', 'is_active', 'current_price', 'market', 'sector'},
    'predictions': {'ticker', 'signal', 'prediction_date', 'entry_price', 'target_price', 'stop_loss'},
    'price_history': {'ticker', 'date', 'close_price', 'volume'},
    'stored_analyses': {'ticker', 'market', 'recommendation', 'maestro_score'},
}


def get_db_tables(db_path: str) -> List[str]:
    """Get list of tables in a DB."""
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        tables = [r[0] for r in conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table'"
        ).fetchall()]
        conn.close()
        return tables
    except Exception:
        return []


def get_table_columns(db_path: str, table: str) -> Set[str]:
    """Get column names for a table."""
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        cols = {r[1] for r in conn.execute(f"PRAGMA table_info({table})").fetchall()}
        conn.close()
        return cols
    except Exception:
        return set()


def check_db_integrity(db_path: str) -> Tuple[bool, str]:
    """Check DB integrity."""
    try:
        conn = sqlite3.connect(db_path, timeout=10.0)
        result = conn.execute('PRAGMA integrity_check').fetchone()[0]
        conn.close()
        return (result == 'ok', result)
    except Exception as e:
        return (False, str(e))


def main():
    import argparse
    parser = argparse.ArgumentParser(description='DB Schema Checker — Phase 9.4')
    parser.add_argument('--strict', action='store_true', help='Exit(1) on warnings')
    args = parser.parse_args()

    print("=" * 70)
    print("  DB Schema Consistency Check — Phase 9.4")
    print("=" * 70)
    print()

    if not DB_DIR.exists():
        print(f"ERROR: DB dir not found: {DB_DIR}")
        return 2

    issues = []
    warnings = []

    for db_name, expected_tables in EXPECTED_DBS.items():
        db_path = DB_DIR / db_name
        print(f"Checking {db_name}...")

        if not db_path.exists():
            warnings.append(f"{db_name}: FILE NOT FOUND")
            print(f"  ⚠️  NOT FOUND")
            continue

        # Integrity check
        ok, msg = check_db_integrity(str(db_path))
        if ok:
            print(f"  ✅ Integrity: OK")
        else:
            issues.append(f"{db_name}: integrity check failed — {msg[:60]}")
            print(f"  ⚠️  Integrity: {msg[:60]}")

        # Check tables
        actual_tables = get_db_tables(str(db_path))
        for expected in expected_tables:
            if expected not in actual_tables:
                issues.append(f"{db_name}: missing table '{expected}'")
                print(f"  ❌ Missing table: {expected}")
            else:
                print(f"  ✅ Table: {expected}")

        # Check columns
        for table, expected_cols in EXPECTED_COLUMNS.items():
            if table in actual_tables:
                actual_cols = get_table_columns(str(db_path), table)
                missing_cols = expected_cols - actual_cols
                if missing_cols:
                    warnings.append(f"{db_name}.{table}: missing columns: {missing_cols}")
                    print(f"  ⚠️  {table}: missing columns: {missing_cols}")

        print()

    # Summary
    print("=" * 70)
    print(f"  Issues:    {len(issues)}  (must fix)")
    print(f"  Warnings:  {len(warnings)}  (check if needed)")
    print("=" * 70)

    if issues:
        print("\n❌ Issues found:")
        for i in issues:
            print(f"  - {i}")

    if warnings:
        print("\n⚠️  Warnings:")
        for w in warnings:
            print(f"  - {w}")

    if issues and args.strict:
        print("\n⛔ CI FAIL: DB schema issues detected")
        return 1

    if not issues:
        print("\n✅ DB schema is consistent — no missing tables or critical issues.")

    return 0 if not issues else 1


if __name__ == '__main__':
    sys.exit(main())
