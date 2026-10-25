#!/usr/bin/env python3
"""
update_free_float.py — FREE-FLOAT-023
=====================================
سكربت آمن (idempotent) لتحديث الأسهم الحرة في stocks.db.

الخطوات:
  1) Migration آمن (try/except):
     - ALTER TABLE stocks ADD COLUMN free_float_percentage REAL
     - ALTER TABLE stocks ADD COLUMN free_float_shares  INTEGER
  2) محاولة تعبئة free_float_percentage من مصادر EGX المتاحة (إن وجدت).
  3) لو مفيش بيانات متاحة، يترك القيمة NULL — النظام يقرأها لكن لا يحذر.
  4) يدعم التعبئة اليدوية لاحقاً من ملف JSON خارجي (اختياري).

التشغيل:
  python3 scripts/update_free_float.py
  python3 scripts/update_free_float.py --source /path/to/free_float.json
  python3 scripts/update_free_float.py --ticker COMI --pct 25.5

الـ JSON format المتوقع (اختياري):
  {
    "COMI": {"free_float_percentage": 25.5, "free_float_shares": 1200000},
    "EKHO": {"free_float_percentage": 8.0,  "free_float_shares": 300000}
  }

Author: FREE-FLOAT-023 (general-purpose agent)
"""

import os
import sys
import json
import sqlite3
from pathlib import Path

# تحديد قاعدة البيانات (نفس المنطق المتبع في باقي السكربتات)
_PROJECT_ROOT = Path(__file__).resolve().parent.parent
STOCKS_DB = os.environ.get(
    'DATABASE_PATH',
    str(_PROJECT_ROOT / 'db' / 'stocks.db'),
)


# ============================================================================
# Migration (Safe — try/except)
# ============================================================================

def _column_exists(cursor: sqlite3.Cursor, table: str, column: str) -> bool:
    """تحقق هل العمود موجود في الجدول."""
    try:
        cursor.execute(f"PRAGMA table_info({table})")
        rows = cursor.fetchall()
        return any(row[1] == column for row in rows)
    except sqlite3.Error:
        return False


def migrate_free_float_columns(conn: sqlite3.Connection) -> dict:
    """
    Migration آمن: يضيف عمودي free_float_percentage و free_float_shares
    لجدول stocks باستخدام ALTER TABLE مع try/except.
    يعمل بشكل idempotent (آمن للتشغيل المتكرر).
    """
    result = {'free_float_percentage': False, 'free_float_shares': False, 'added': []}
    cursor = conn.cursor()

    # 1) free_float_percentage (REAL)
    if _column_exists(cursor, 'stocks', 'free_float_percentage'):
        result['free_float_percentage'] = True  # موجود مسبقاً
    else:
        try:
            cursor.execute(
                "ALTER TABLE stocks ADD COLUMN free_float_percentage REAL"
            )
            conn.commit()
            result['free_float_percentage'] = True
            result['added'].append('free_float_percentage')
            print("✅ Added column: stocks.free_float_percentage (REAL)")
        except sqlite3.OperationalError as e:
            # الخطأ الشائع: "duplicate column name" — معناه إنه أُضيف مسبقاً
            if 'duplicate column' in str(e).lower():
                result['free_float_percentage'] = True
                print("ℹ️  free_float_percentage already exists (duplicate column)")
            else:
                print(f"❌ Failed to add free_float_percentage: {e}")
                raise
        except sqlite3.Error as e:
            print(f"❌ Unexpected SQLite error on free_float_percentage: {e}")
            raise

    # 2) free_float_shares (INTEGER)
    if _column_exists(cursor, 'stocks', 'free_float_shares'):
        result['free_float_shares'] = True  # موجود مسبقاً
    else:
        try:
            cursor.execute(
                "ALTER TABLE stocks ADD COLUMN free_float_shares INTEGER"
            )
            conn.commit()
            result['free_float_shares'] = True
            result['added'].append('free_float_shares')
            print("✅ Added column: stocks.free_float_shares (INTEGER)")
        except sqlite3.OperationalError as e:
            if 'duplicate column' in str(e).lower():
                result['free_float_shares'] = True
                print("ℹ️  free_float_shares already exists (duplicate column)")
            else:
                print(f"❌ Failed to add free_float_shares: {e}")
                raise
        except sqlite3.Error as e:
            print(f"❌ Unexpected SQLite error on free_float_shares: {e}")
            raise

    return result


# ============================================================================
# Data Update (Safe — leaves NULL if no data)
# ============================================================================

def _try_fetch_egx_free_float() -> dict:
    """
    محاولة جلب نسبة الأسهم الحرة من مصادر EGX المتاحة.
    حالياً مفيش مصدر آلي موثوق — نرجّع dict فاضي.
    المستخدم يقدر يعبّيه يدوياً عبر --source JSON.

    ملاحظة: لو في المستقبل اتوفر مصدر (مثل Investing.com scraper أو
    بيانات EGX الرسمية)، يُضاف هنا.
    """
    # محاولة تجربة egx_fundamental_fetcher لو متوفر (best-effort، لا يكسر)
    try:
        sys.path.insert(0, str(_PROJECT_ROOT / 'vps-service'))
        from data.egx_fundamental_fetcher import (
            fetch_fundamentals as _fetch_fn,  # قد لا توجد
        )
        # لو الدالة موجودة، نجرب (لكن الـ API قد لا يرجّع free_float)
        # نتجاهل أي خطأ — الهدف هو عدم كسر السكربت
    except Exception:
        pass

    return {}


def update_from_dict(conn: sqlite3.Connection, data: dict) -> int:
    """
    تحديث free_float_percentage و free_float_shares من dict.
    البيانات بالشكل: {ticker: {'free_float_percentage': X, 'free_float_shares': Y}}
    """
    if not data:
        return 0
    cursor = conn.cursor()
    updated = 0
    for ticker, info in data.items():
        if not isinstance(info, dict):
            continue
        pct = info.get('free_float_percentage')
        shares = info.get('free_float_shares')
        if pct is None and shares is None:
            continue
        try:
            cursor.execute(
                """UPDATE stocks
                   SET free_float_percentage = ?,
                       free_float_shares = ?
                   WHERE ticker = ?""",
                (pct, shares, ticker),
            )
            if cursor.rowcount > 0:
                updated += 1
        except sqlite3.Error as e:
            print(f"⚠️  Failed to update {ticker}: {e}")
    conn.commit()
    return updated


def update_single(conn: sqlite3.Connection, ticker: str, pct: float,
                  shares: int = None) -> bool:
    """تحديث سهم واحد يدوياً."""
    cursor = conn.cursor()
    try:
        cursor.execute(
            """UPDATE stocks
               SET free_float_percentage = ?,
                   free_float_shares = ?
               WHERE ticker = ?""",
            (pct, shares, ticker),
        )
        conn.commit()
        return cursor.rowcount > 0
    except sqlite3.Error as e:
        print(f"❌ Failed to update {ticker}: {e}")
        return False


def show_stats(conn: sqlite3.Connection):
    """عرض إحصائيات الأسهم الحرة في القاعدة."""
    cursor = conn.cursor()
    try:
        cursor.execute("""
            SELECT
                COUNT(*) AS total,
                SUM(CASE WHEN free_float_percentage IS NOT NULL THEN 1 ELSE 0 END) AS populated,
                SUM(CASE WHEN free_float_percentage < 5 THEN 1 ELSE 0 END) AS critical,
                SUM(CASE WHEN free_float_percentage >= 5 AND free_float_percentage < 15 THEN 1 ELSE 0 END) AS risky,
                SUM(CASE WHEN free_float_percentage >= 15 THEN 1 ELSE 0 END) AS ok
            FROM stocks
        """)
        row = cursor.fetchone()
        total, populated, critical, risky, ok = (row or (0, 0, 0, 0, 0))
        print("\n📊 Free Float Stats:")
        print(f"   Total stocks:    {total}")
        print(f"   Populated:       {populated} ({(populated / total * 100) if total else 0:.1f}%)")
        print(f"   NULL (no warn):  {total - populated}")
        print(f"   Critical (< 5%): {critical} 🚨")
        print(f"   Risky (5-15%):   {risky} ⚠️")
        print(f"   OK (≥ 15%):      {ok} ✅")
    except sqlite3.Error as e:
        print(f"⚠️  Stats query failed: {e}")


# ============================================================================
# CLI
# ============================================================================

def main():
    import argparse
    parser = argparse.ArgumentParser(
        description='Update free_float_percentage / free_float_shares in stocks.db (FREE-FLOAT-023)',
    )
    parser.add_argument(
        '--source', type=str, default=None,
        help='Path to JSON file with {ticker: {free_float_percentage, free_float_shares}}',
    )
    parser.add_argument(
        '--ticker', type=str, default=None,
        help='Update a single ticker (requires --pct)',
    )
    parser.add_argument(
        '--pct', type=float, default=None,
        help='Free float percentage (0-100) for --ticker',
    )
    parser.add_argument(
        '--shares', type=int, default=None,
        help='Free float shares count for --ticker',
    )
    parser.add_argument(
        '--db', type=str, default=STOCKS_DB,
        help=f'Path to stocks.db (default: {STOCKS_DB})',
    )
    parser.add_argument(
        '--stats-only', action='store_true',
        help='Just show stats and exit (no migration, no update)',
    )
    args = parser.parse_args()

    db_path = args.db
    if not os.path.exists(db_path):
        print(f"❌ stocks.db not found at {db_path}")
        return 1

    print("=" * 60)
    print("FREE-FLOAT-023: update_free_float.py")
    print(f"DB: {db_path}")
    print("=" * 60)

    # Phase 7.1: migrated to db_manager (writable=False)
    from core.db_manager import db_manager
    conn = db_manager.connection(db_path, writable=False).__enter__()

    try:
        if args.stats_only:
            # فقط عرض الإحصائيات (يفترض الأعمدة موجودة)
            try:
                show_stats(conn)
            except sqlite3.Error as e:
                print(f"⚠️  Stats failed (columns may not exist yet): {e}")
            return 0

        # 1) Migration (idempotent, try/except)
        print("\n📝 Step 1: Migration (ALTER TABLE)...")
        mig = migrate_free_float_columns(conn)
        if not (mig['free_float_percentage'] and mig['free_float_shares']):
            print("❌ Migration failed — aborting.")
            return 1
        if mig['added']:
            print(f"   Added columns: {mig['added']}")
        else:
            print("   All columns already exist — no changes needed.")

        # 2) Data Update
        print("\n📝 Step 2: Data update...")
        updated = 0
        if args.ticker and args.pct is not None:
            print(f"   Updating single ticker {args.ticker} → {args.pct}% (shares={args.shares})")
            ok = update_single(conn, args.ticker, args.pct, args.shares)
            updated = 1 if ok else 0
            print(f"   {'✅' if ok else '❌'} Single update {'succeeded' if ok else 'failed (ticker not found?)'}")
        elif args.source:
            print(f"   Loading data from {args.source}...")
            try:
                with open(args.source, 'r', encoding='utf-8') as f:
                    data = json.load(f)
                updated = update_from_dict(conn, data)
                print(f"   ✅ Updated {updated} stocks from JSON")
            except (OSError, json.JSONDecodeError) as e:
                print(f"❌ Failed to load source JSON: {e}")
                return 1
        else:
            # محاولة تلقائية (best-effort) — عادةً بترجع فاضي
            print("   Trying automatic EGX sources (best-effort)...")
            data = _try_fetch_egx_free_float()
            if data:
                updated = update_from_dict(conn, data)
                print(f"   ✅ Updated {updated} stocks from EGX sources")
            else:
                print("   ℹ️  No automatic EGX source available — leaving NULL (system will not warn).")
                print("   💡 لتعبئة يدوية لاحقاً:")
                print('      python3 scripts/update_free_float.py --source free_float.json')
                print('      python3 scripts/update_free_float.py --ticker COMI --pct 25.5')

        # 3) Stats
        show_stats(conn)

        print("\n✅ Done. (idempotent — safe to re-run)")
        return 0
    finally:
        conn.close()


if __name__ == '__main__':
    sys.exit(main())
