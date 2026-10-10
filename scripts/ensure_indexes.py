#!/usr/bin/env python3
"""
ensure_indexes.py — Database Indexing (Performance & Stability)
================================================================
(Phase 9 — Task 3: Database Indexing)

المشكلة اللي بتحلها:
    الـ db_manager.py بيتعمل ليه SELECT من جداول كبيرة (stock_daily_prices =
    126,870 صف، stored_analyses = آلاف الصفوف) بس مفيش Indexes محسوبة على
    الـ ticker و الـ date. كل query ببيعمل full table scan → بطيء + CPU عالي.

الحل:
    السكريبت ده بيعمل `CREATE INDEX IF NOT EXISTS` على:
      1. stock_daily_prices (ticker, price_date DESC)  — في stocks.db
      2. stored_analyses (ticker, created_at DESC)     — في predictions.db
         (ملاحظة: الجدول مفيهوش analysis_date؛ created_at هو الـ timestamp)
      3. stocks (ticker)                               — في stocks.db
      4. stored_analyses (ticker, market)              — bonus composite
      5. stock_daily_prices (price_date DESC)          — bonus للـ date-range queries

    كل الـ indexes بـ `IF NOT EXISTS` — safe للتشغيل المتكرر (idempotent).

الاستخدام:
    cd /home/z/my-project
    python3 scripts/ensure_indexes.py

مبدأ التصميم:
    - مايعملش LOCK للداتابيز — كل index بيتعمل في transaction منفصل.
    - بيتحقق من وجود الجدول والأعمدة قبل ما يعمل الـ index (safe للـ schemas المختلفة).
    - بيطبع تقرير واضح في الآخر (✅/⏭️/❌ لكل index).
    - بستخدم db_manager.py (WAL + busy_timeout) للـ connection.
    - idempotent: لو الـ index موجود، بيطبع ⏭️ skipped ومابيعملش حاجة.

ملاحظة على التسمية:
    الـ task الأصلي ذكر `price_history (ticker, date DESC)` و
    `stored_analyses (ticker, analysis_date DESC)`. في الكود الفعلي:
      - جدول الأسعار اسمه `stock_daily_prices` (في stocks.db) بأعمدة ticker + price_date.
      - جدول التحليلات اسمه `stored_analyses` (في predictions.db) بأعمدة ticker + created_at
        (مفيهوش analysis_date؛ created_at هو الـ timestamp).
    السكريبت بيتعامل مع الأسماء الفعلية + بيحاول الأسماء الأصلية كـ fallback.
"""
from __future__ import annotations

import os
import sys
import time
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# إضافة vps-service لـ Python path عشان نستورد db_manager
# ---------------------------------------------------------------------------
_SCRIPT_DIR = Path(__file__).resolve().parent  # scripts/
_PROJECT_ROOT = _SCRIPT_DIR.parent              # /home/z/my-project
_VPS_SERVICE = _PROJECT_ROOT / 'vps-service'
sys.path.insert(0, str(_VPS_SERVICE))

try:
    from core.db_manager import db_manager  # type: ignore
    _HAS_DB_MANAGER = True
except ImportError as e:
    print(f"⚠️  Cannot import db_manager from vps-service/core/: {e}")
    print("    Falling back to direct sqlite3.")
    _HAS_DB_MANAGER = False
    import sqlite3  # type: ignore


# ---------------------------------------------------------------------------
# تعريف الـ indexes المطلوبة
# ---------------------------------------------------------------------------
# كل entry: (db_name, table, index_name, column_expr, description)
# السكريبت بيتحقق من وجود الجدول + الأعمدة قبل ما يعمل الـ index.
INDEX_SPECS: List[Dict[str, str]] = [
    {
        'db': 'stocks',
        'table': 'stock_daily_prices',
        'index_name': 'idx_sdp_ticker_date',
        'columns': 'ticker, price_date DESC',
        'required_cols': ['ticker', 'price_date'],
        'description': 'تسريع SELECT ... WHERE ticker=? ORDER BY price_date DESC (126,870 صف)',
    },
    {
        'db': 'stocks',
        'table': 'stock_daily_prices',
        'index_name': 'idx_sdp_date',
        'columns': 'price_date DESC',
        'required_cols': ['price_date'],
        'description': 'تسريع date-range queries (آخر N يوم لكل الأسهم)',
    },
    {
        'db': 'stocks',
        'table': 'stock_daily_prices',
        'index_name': 'idx_sdp_ticker',
        'columns': 'ticker',
        'required_cols': ['ticker'],
        'description': 'تسريع SELECT ... WHERE ticker=? (lookup سهم واحد)',
    },
    {
        'db': 'stocks',
        'table': 'stocks',
        'index_name': 'idx_stocks_ticker',
        'columns': 'ticker',
        'required_cols': ['ticker'],
        'description': 'تسريع SELECT ... WHERE ticker=? على جدول الأسهم الرئيسي',
    },
    {
        'db': 'stocks',
        'table': 'stocks',
        'index_name': 'idx_stocks_market',
        'columns': 'market',
        'required_cols': ['market'],
        'description': 'تسريع فلترة الأسهم حسب السوق (EGX/TADAWUL/KSE/QSE)',
    },
    {
        'db': 'predictions',
        'table': 'stored_analyses',
        'index_name': 'idx_stored_ticker_date',
        'columns': 'ticker, created_at DESC',
        'required_cols': ['ticker', 'created_at'],
        'description': 'تسريع SELECT ... WHERE ticker=? ORDER BY created_at DESC',
    },
    {
        'db': 'predictions',
        'table': 'stored_analyses',
        'index_name': 'idx_stored_ticker_market',
        'columns': 'ticker, market',
        'required_cols': ['ticker', 'market'],
        'description': 'تسريع lookup التحليلات بـ ticker+market',
    },
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _get_db_path(db_name: str) -> str:
    """ارجع المسار المطلق للـ DB عبر db_manager أو fallback."""
    if _HAS_DB_MANAGER:
        try:
            from core.db_manager import resolve_path  # type: ignore
            return resolve_path(db_name)
        except Exception:
            pass
    # Fallback: <project_root>/db/<name>.db
    return str(_PROJECT_ROOT / 'db' / f'{db_name}.db')


def _table_exists(db_name: str, table: str) -> bool:
    """اتأكد إن الجدول موجود في الـ DB."""
    if _HAS_DB_MANAGER:
        try:
            return db_manager.table_exists(db_name, table)
        except Exception:
            pass
    # Fallback
    path = _get_db_path(db_name)
    if not os.path.exists(path):
        return False
    import sqlite3
    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' AND name=?",
            (table,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def _table_columns(db_name: str, table: str) -> List[str]:
    """ارجع أسماء أعمدة الجدول."""
    if _HAS_DB_MANAGER:
        try:
            return db_manager.table_columns(db_name, table)
        except Exception:
            pass
    path = _get_db_path(db_name)
    if not os.path.exists(path):
        return []
    import sqlite3
    conn = sqlite3.connect(path)
    try:
        return [r[1] for r in conn.execute(f'PRAGMA table_info({table})').fetchall()]
    finally:
        conn.close()


def _index_exists(db_name: str, index_name: str) -> bool:
    """اتأكد إن الـ index موجود فعلاً (عشان نعمل skip لو موجود)."""
    if _HAS_DB_MANAGER:
        try:
            row = db_manager.query_one(
                db_name,
                "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
                (index_name,),
            )
            return row is not None
        except Exception:
            pass
    path = _get_db_path(db_name)
    if not os.path.exists(path):
        return False
    import sqlite3
    conn = sqlite3.connect(path)
    try:
        row = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='index' AND name=?",
            (index_name,),
        ).fetchone()
        return row is not None
    finally:
        conn.close()


def _create_index(db_name: str, index_name: str, table: str, columns: str) -> None:
    """نفّذ CREATE INDEX IF NOT EXISTS."""
    sql = f'CREATE INDEX IF NOT EXISTS {index_name} ON {table} ({columns})'
    if _HAS_DB_MANAGER:
        db_manager.execute(db_name, sql)
    else:
        path = _get_db_path(db_name)
        import sqlite3
        conn = sqlite3.connect(path, timeout=30.0)
        try:
            conn.execute('PRAGMA journal_mode=WAL')
            conn.execute('PRAGMA busy_timeout=30000')
            conn.execute(sql)
            conn.commit()
        finally:
            conn.close()


# ---------------------------------------------------------------------------
# الرئيسية
# ---------------------------------------------------------------------------
def main() -> int:
    print("=" * 72)
    print("ensure_indexes.py — Database Indexing (Phase 9, Task 3)")
    print("=" * 72)
    print(f"Project root : {_PROJECT_ROOT}")
    print(f"Backend      : {'db_manager.py' if _HAS_DB_MANAGER else 'direct sqlite3 (fallback)'}")
    print(f"Indexes      : {len(INDEX_SPECS)} specs")
    print()

    results: List[Dict[str, Any]] = []
    created = 0
    skipped = 0
    failed = 0

    for spec in INDEX_SPECS:
        db = spec['db']
        table = spec['table']
        idx = spec['index_name']
        cols_expr = spec['columns']
        required = spec['required_cols']
        desc = spec['description']

        print(f"→ {db}.{table} → {idx} ({cols_expr})")
        print(f"    {desc}")

        # Step 1: اتأكد إن الجدول موجود
        if not _table_exists(db, table):
            print(f"    ⏭️  SKIPPED — table '{table}' not found in {db}.db")
            results.append({'spec': spec, 'status': 'skipped', 'reason': 'table not found'})
            skipped += 1
            continue

        # Step 2: اتأكد إن الأعمدة المطلوبة موجودة
        existing_cols = _table_columns(db, table)
        missing_cols = [c for c in required if c not in existing_cols]
        if missing_cols:
            print(f"    ⏭️  SKIPPED — columns {missing_cols} not in {table} (have: {existing_cols[:8]}...)")
            results.append({'spec': spec, 'status': 'skipped', 'reason': f'missing columns {missing_cols}'})
            skipped += 1
            continue

        # Step 3: اتأكد إن الـ index مش موجود بالفعل
        if _index_exists(db, idx):
            print(f"    ⏭️  SKIPPED — index '{idx}' already exists")
            results.append({'spec': spec, 'status': 'skipped', 'reason': 'already exists'})
            skipped += 1
            continue

        # Step 4: اعمل الـ index
        try:
            t0 = time.time()
            _create_index(db, idx, table, cols_expr)
            dt = (time.time() - t0) * 1000
            print(f"    ✅ CREATED in {dt:.1f}ms")
            results.append({'spec': spec, 'status': 'created', 'timing_ms': dt})
            created += 1
        except Exception as e:
            print(f"    ❌ FAILED — {e}")
            results.append({'spec': spec, 'status': 'failed', 'error': str(e)})
            failed += 1

    # ── تقرير نهائي ──
    print()
    print("=" * 72)
    print("Summary")
    print("=" * 72)
    print(f"  ✅ Created : {created}")
    print(f"  ⏭️  Skipped : {skipped}  (already exists / table missing / cols missing)")
    print(f"  ❌ Failed  : {failed}")
    print()

    if _HAS_DB_MANAGER:
        try:
            stats = db_manager.get_stats()
            print(f"  db_manager stats: {stats}")
        except Exception:
            pass

    # ─ـ تحقق سريع: اعرض الـ indexes الفعلية في كل DB ──
    print()
    print("Current indexes after run:")
    for db_name in sorted({s['db'] for s in INDEX_SPECS}):
        path = _get_db_path(db_name)
        if not os.path.exists(path):
            continue
        import sqlite3
        conn = sqlite3.connect(path)
        try:
            rows = conn.execute(
                "SELECT name, tbl_name FROM sqlite_master WHERE type='index' AND sql IS NOT NULL ORDER BY tbl_name, name"
            ).fetchall()
            print(f"  {db_name}.db:")
            for r in rows:
                print(f"    {r[1]:25s} → {r[0]}")
        finally:
            conn.close()

    print()
    if failed > 0:
        print("⚠️  Some indexes failed. Review the errors above.")
        return 1
    print("✅ ensure_indexes.py completed successfully.")
    return 0


if __name__ == '__main__':
    sys.exit(main())
