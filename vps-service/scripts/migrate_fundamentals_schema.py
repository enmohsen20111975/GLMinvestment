#!/usr/bin/env python3
"""
migrate_fundamentals_schema.py — إصلاح إزاحة الأعمدة في data_engine.db (Stage B fix)

السياق (من DATA_ENGINE_FUNDAMENTALS_INVENTORY + التحقق المباشر):
  جداول tab_balance_sheet / tab_income_statement / tab_cash_flow فيها 866 صفًا.
  منهم:
    - 858 صف سليم: symbol=ticker (مثل '1010')، market=اسم السوق، الأعمدة في مكانها الصحيح.
    - 8 صفوف shifted: symbol=اسم السوق ('السعودية')، market=fiscal_period،
      fiscal_period=fiscal_end، والبيانات shifted يمينًا. الـ ticker مفقود نهائيًا
      (الـ fetcher لم يكتبه أصلًا لهذه الصفوف).

لماذا الحذف بدل الإصلاح؟
  - الـ ticker غير موجود في الصف الـ shifted ولا يمكن استعادته (لا join key مع stocks).
  - معظم الصفوف الـ shifted بياناتها NULL أصلاً (شوف tab_balance_sheet id=9551).
  - الـ 858 صف السليم كافٍ لتغطية التحليل الأساسي.

القاعدة 1 (حرمة DB الإنتاج): السكربت ده بـ يشتغل على db/vps_real/data_engine.db
فقط (الساندبوكس). الإنتاج read-only — لا يُنقل التعديل إلا بعد موافقة المالك.

Usage:
  # Dry-run (افتراضي — بـ يطبع التقرير بس من غير تعديل):
  python3 vps-service/scripts/migrate_fundamentals_schema.py

  # تنفيذ فعلي بعد مراجعة الـ dry-run:
  python3 vps-service/scripts/migrate_fundamentals_schema.py --apply

Exit codes:
  0 = نجاح (أو dry-run اكتمل)
  1 = خطأ (DB غير موجود / فشل backup / فشل DELETE)
"""
from __future__ import annotations
import os
import re
import sys
import sqlite3
import argparse
from datetime import datetime

# ─── Paths (relative — Rule 17) ───
PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..'))
DEFAULT_DB = os.path.join(PROJECT_ROOT, 'db', 'vps_real', 'data_engine.db')

# Tables to fix
SHIFTED_TABLES = ['tab_balance_sheet', 'tab_income_statement', 'tab_cash_flow']

# Known market names (from tab_valuation DISTINCT market)
MARKET_NAMES = ('السعودية', 'مصر', 'الكويت', 'قطر')

# fiscal_period pattern: YYYY-Qn, YYYY-Hn, YYYY-FY
FP_RE = re.compile(r'^\d{4}-(Q[1-4]|H[1-2]|FY)$')


def detect_shifted_rows(cur, table: str) -> list[int]:
    """أرجع list بـ ids للصفوف الـ shifted (symbol=market name + market=fiscal_period)."""
    cur.execute(
        f"SELECT id, symbol, market FROM {table} "
        f"WHERE symbol IN ({','.join('?' * len(MARKET_NAMES))})",
        MARKET_NAMES,
    )
    shifted_ids = []
    for row_id, sym, mkt in cur.fetchall():
        # Confirm: market column holds a fiscal_period pattern (true shift indicator)
        if FP_RE.match(str(mkt or '')):
            shifted_ids.append(row_id)
    return shifted_ids


def count_clean_rows(cur, table: str) -> int:
    """عدّ الصفوف السليمة (symbol ليس اسم سوق + market هو اسم سوق)."""
    placeholders = ','.join('?' * len(MARKET_NAMES))
    cur.execute(
        f"SELECT COUNT(*) FROM {table} "
        f"WHERE symbol NOT IN ({placeholders}) "
        f"AND market IN ({placeholders})",
        (*MARKET_NAMES, *MARKET_NAMES),
    )
    return cur.fetchone()[0]


def backup_table(conn, cur, table: str) -> str:
    """اعمل backup copy للجدول قبل التعديل (suffix بـ timestamp)."""
    ts = datetime.now().strftime('%Y%m%d_%H%M%S')
    backup_name = f"_backup_{table}_{ts}"
    cur.execute(f"DROP TABLE IF EXISTS {backup_name}")
    cur.execute(f"CREATE TABLE {backup_name} AS SELECT * FROM {table}")
    conn.commit()
    return backup_name


def migrate(db_path: str, apply: bool = False) -> int:
    if not os.path.exists(db_path):
        print(f"❌ DB not found: {db_path}", file=sys.stderr)
        return 1

    print(f"🔗 DB: {db_path}")
    print(f"🔧 Mode: {'APPLY' if apply else 'DRY-RUN (no changes)'}")
    print()

    # Read-only check for dry-run; read-write for apply
    if apply:
        conn = sqlite3.connect(db_path, timeout=30.0)
    else:
        conn = sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=30.0)
    cur = conn.cursor()

    total_deleted = 0
    for table in SHIFTED_TABLES:
        print(f"── {table} ──")
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        total = cur.fetchone()[0]
        clean = count_clean_rows(cur, table)
        shifted_ids = detect_shifted_rows(cur, table)
        print(f"  total rows:    {total}")
        print(f"  clean rows:    {clean}")
        print(f"  shifted rows:  {len(shifted_ids)}  (ids: {shifted_ids})")

        if not shifted_ids:
            print(f"  ✓ no shifted rows — skipping")
            print()
            continue

        if not apply:
            print(f"  [DRY-RUN] would DELETE {len(shifted_ids)} shifted rows from {table}")
            print()
            continue

        # APPLY mode: backup → delete → verify
        backup_name = backup_table(conn, cur, table)
        print(f"  ✓ backup created: {backup_name}")

        placeholders = ','.join('?' * len(shifted_ids))
        cur.execute(f"DELETE FROM {table} WHERE id IN ({placeholders})", shifted_ids)
        deleted = cur.rowcount
        conn.commit()
        total_deleted += deleted
        print(f"  ✓ DELETED {deleted} shifted rows")

        # Verify: remaining rows should all be clean
        cur.execute(f"SELECT COUNT(*) FROM {table}")
        remaining = cur.fetchone()[0]
        remaining_shifted = detect_shifted_rows(cur, table)
        print(f"  ✓ remaining: {remaining} rows, shifted: {len(remaining_shifted)}")
        print()

    if apply:
        cur.execute("VACUUM")
        print(f"✓ VACUUM complete. Total deleted across 3 tables: {total_deleted}")
    else:
        print(f"[DRY-RUN] Total that would be deleted across 3 tables: {sum(len(detect_shifted_rows(cur, t)) for t in SHIFTED_TABLES)}")
        print("Run with --apply to execute.")

    conn.close()
    return 0


def main():
    parser = argparse.ArgumentParser(
        description='Fix column-shift in tab_balance_sheet/income_statement/cash_flow (sandbox only)',
    )
    parser.add_argument('--db', default=DEFAULT_DB, help='Path to data_engine.db (default: db/vps_real/data_engine.db)')
    parser.add_argument('--apply', action='store_true', help='Execute the migration (default: dry-run)')
    args = parser.parse_args()
    sys.exit(migrate(args.db, apply=args.apply))


if __name__ == '__main__':
    main()
