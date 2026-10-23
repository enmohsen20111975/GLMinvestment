"""
scripts/migrate_predictions_exit_protocol.py
============================================
سكريبت migration لإضافة أعمدة خطة الخروج الثلاثية لجدول predictions.

الأعمدة المضافة:
- tp1_price REAL — سعر الهدف الأول (+6.5%)
- tp2_price REAL — سعر الهدف الثاني
- trailing_stop_pct REAL DEFAULT 2.5 — نسبة الوقف المتحرك
- max_hold_days INTEGER DEFAULT 5 — أقصى مدة بقاء بالأيام
- exit_protocol TEXT — اسم خطة الخروج ('TP1_6PCT_TIME_STOP_5D')
- user_advice_ar TEXT — النصيحة المباشرة للزبون

Usage:
    python3 scripts/migrate_predictions_exit_protocol.py
"""
import sqlite3
import os
from pathlib import Path

PROJECT_ROOT = Path(__file__).resolve().parents[1]
DB_PATH = PROJECT_ROOT / 'db' / 'predictions.db'

NEW_COLS = [
    ("tp1_price", "REAL"),
    ("tp2_price", "REAL"),
    ("trailing_stop_pct", "REAL DEFAULT 2.5"),
    ("max_hold_days", "INTEGER DEFAULT 5"),
    ("exit_protocol", "TEXT"),
    ("user_advice_ar", "TEXT"),
]


def run_migration():
    if not DB_PATH.exists():
        print(f"❌ DB not found: {DB_PATH}")
        return 1

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(str(DB_PATH), writable=False).__enter__()
    cur = conn.cursor()

    existing = [c[1] for c in cur.execute("PRAGMA table_info(predictions)").fetchall()]
    added = 0
    for col, ddl in NEW_COLS:
        if col not in existing:
            cur.execute(f"ALTER TABLE predictions ADD COLUMN {col} {ddl}")
            print(f"  ✅ added: {col} ({ddl})")
            added += 1
        else:
            print(f"  ⏭️ exists: {col}")

    # update existing rows with defaults
    updated = cur.execute("""
        UPDATE predictions SET 
            max_hold_days = COALESCE(max_hold_days, 5),
            trailing_stop_pct = COALESCE(trailing_stop_pct, 2.5),
            exit_protocol = COALESCE(exit_protocol, 'TP1_6PCT_TIME_STOP_5D'),
            tp1_price = COALESCE(tp1_price, CASE WHEN target_price > 0 THEN ROUND(target_price, 2) ELSE NULL END)
    """).rowcount
    conn.commit()
    print(f"\n  rows updated: {updated}")
    print(f"  columns added: {added}")
    conn.close()
    return 0


if __name__ == "__main__":
    exit(run_migration())
