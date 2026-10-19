#!/usr/bin/env python3
"""
diagnose_tab_schema.py — تشخيص الـ tab_* schema على أي DB
=====================================================================
بيـ print الـ schema الفعلي لكل tab_* tables (أو أي tables مش موجودة).
آمن — read-only، ما بـ يـ modifyش أي حاجة.

الاستخدام:
  python3 scripts/diagnose_tab_schema.py
"""
import sqlite3
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_FILE = PROJECT_ROOT / "db" / "data_engine.db"

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


def main():
    print("=" * 70)
    print("تشخيص tab_* schema")
    print(f"DB: {DB_FILE}")
    print("=" * 70)

    if not DB_FILE.exists():
        print(f"❌ DB not found: {DB_FILE}")
        return

    conn = sqlite3.connect(str(DB_FILE), timeout=30.0)

    # 1. كل الـ tables في الـ DB
    print("\n📋 كل الـ tables في data_engine.db:")
    all_tables = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' ORDER BY name"
    ).fetchall()
    for (t,) in all_tables:
        print(f"  - {t}")

    # 2. فحص كل tab_* table
    print("\n" + "=" * 70)
    print("فحص tab_* tables:")
    print("=" * 70)

    for table in TAB_TABLES:
        print(f"\n--- {table} ---")
        try:
            # هل الـ table موجود؟
            exists = conn.execute(
                "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
                (table,),
            ).fetchone()

            if not exists:
                print(f"  ❌ Table مش موجود")
                continue

            # الـ columns
            cols = conn.execute(f"PRAGMA table_info({table})").fetchall()
            print(f"  ✅ Table موجود — {len(cols)} columns:")
            for c in cols:
                # c = (cid, name, type, notnull, dflt_value, pk)
                pk = " [PK]" if c[5] else ""
                notnull = " NOT NULL" if c[3] else ""
                print(f"    - {c[1]} ({c[2]}){pk}{notnull}")

            # row count
            cnt = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
            print(f"  📊 row count: {cnt}")

            # عينة 2 rows
            if cnt > 0:
                print(f"  📋 عينة (first 2 rows):")
                rows = conn.execute(f"SELECT * FROM {table} LIMIT 2").fetchall()
                col_names = [c[1] for c in cols]
                for r in rows:
                    print(f"    {dict(zip(col_names, r))}")

        except Exception as e:
            print(f"  ⚠️ Error: {e}")

    # 3. هل فيه tables بـ prefix "tab_" غير الـ 8؟
    print("\n" + "=" * 70)
    print("أي tables تانية بـ prefix 'tab_':")
    print("=" * 70)
    other_tabs = conn.execute(
        "SELECT name FROM sqlite_master WHERE type='table' AND name LIKE 'tab_%' ORDER BY name"
    ).fetchall()
    known = set(TAB_TABLES)
    for (t,) in other_tabs:
        marker = " (known)" if t in known else " (UNKNOWN)"
        print(f"  - {t}{marker}")

    conn.close()
    print("\n" + "=" * 70)
    print("التشخيص خلص.")
    print("=" * 70)


if __name__ == "__main__":
    main()
