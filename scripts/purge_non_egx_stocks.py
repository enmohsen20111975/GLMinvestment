#!/usr/bin/env python3
"""
purge_non_egx_stocks.py — Purge Saudi/Kuwaiti/Gulf stocks from EGX caches.

English
=======
The EGX recommendations / predictions screens are showing non-Egyptian stocks
(Saudi numeric tickers like 2120, 3002, and Kuwaiti symbols like RASIYAT,
OOREDOO, AAYANRE, KSE). The new `_strict_market_filter` code prevents NEW
entries from being written, but OLD polluted rows are still sitting in the
cache tables. This script DELETES them so the UI is clean immediately.

Target tables (in predictions.db):
    - predictions
    - persona_predictions
    - stored_analyses
Target tables (in stocks.db):
    - cached_analysis
    - stocks           (special: set is_active=0 instead of DELETE, per
                        project rule "no hard deletes on stocks")

Deletion logic (per table):
    DELETE FROM <table>
    WHERE ticker IN ('RASIYAT','OOREDOO','AAYANRE','NBK','ZAIN','KPC','KIOC',
                     'KFH','MABANEE','AGTHIA','BOUBYAN','KUWAIT','KWSA','QPWR',
                     'ORDS','NCC','HEICO','CWG','BURJ','AYAN','INVESTORS','GFH')
       OR ticker GLOB '[0-9]*'              -- any ticker starting with a digit
       OR market IN ('TADAWUL','KSE','QSE') -- wrong-market rows

For the `stocks` table we also deactivate (is_active=0) any row whose `market`
is TADAWUL / KSE / QSE, so the master stock list stops advertising Gulf names.

Usage:
    python3 scripts/purge_non_egx_stocks.py            # DRY-RUN (report only)
    python3 scripts/purge_non_egx_stocks.py --apply    # DELETE + backup
    python3 scripts/purge_non_egx_stocks.py --db predictions.db --apply
    python3 scripts/purge_non_egx_stocks.py --db stocks.db --apply

العربية
=======
سكريبت تنظيف الأسهم السعودية والكويتية من كاش التوقعات المصرية. الفلاتر
الصارمة الجديدة بتمنع دخول أسهم جديدة، بس الأسهم القديمة لسه موجودة في
الجداول. السكريبت ده بيمسحها تماماً.

الجداول المستهدفة:
  - predictions.db: predictions, persona_predictions, stored_analyses
  - stocks.db:      cached_analysis, stocks (تعطيل is_active=0 مش مسح)

منطق الحذف:
  - أي رمز يبدأ برقم (أسهم سعودية: 2120, 3002, ...)
  - أي رمز من قائمة الأسهم الكويتية/الخليجية المعروفة
  - أي صف market بتاعه TADAWUL / KSE / QSE
"""

from __future__ import annotations

import argparse
import shutil
import sqlite3
import sys
from pathlib import Path
from typing import Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

PROJECT_ROOT = Path(__file__).resolve().parent.parent
DB_DIR = PROJECT_ROOT / "db"

# Known Kuwaiti / Gulf ticker symbols (mirrors _KUWAIT_GULF_TICKERS in
# vps-service/api/v2_routes.py). Must stay in sync.
KUWAIT_GULF_TICKERS: Tuple[str, ...] = (
    "RASIYAT", "OOREDOO", "AAYANRE", "NBK", "ZAIN", "KPC", "KIOC", "KFH",
    "MABANEE", "AGTHIA", "BOUBYAN", "KUWAIT", "KWSA", "QPWR", "ORDS",
    "NCC", "HEICO", "CWG", "BURJ", "AYAN", "INVESTORS", "GFH",
    # Extra Gulf / Saudi alpha symbols seen in the wild (defensive extras):
    "KSE", "TADAWUL", "QSE", "SAUDI", "ARAMCO",
)

# Markets that are NOT Egyptian — rows with these market values get purged.
NON_EGX_MARKETS: Tuple[str, ...] = ("TADAWUL", "KSE", "QSE", "DFM", "ADX")

# Databases to scan, with the tables to clean.
#  - For most tables we hard-DELETE the polluted rows.
#  - For the `stocks` master table we soft-deactivate (is_active=0) to comply
#    with the project rule "no hard deletes on the stocks table".
DB_TABLES: Dict[str, List[str]] = {
    "predictions.db": ["predictions", "persona_predictions", "stored_analyses"],
    "stocks.db": ["cached_analysis", "stocks"],
}

# The "soft" tables: instead of DELETE, set is_active=0.
SOFT_TABLES = {"stocks"}


def q(ident: str) -> str:
    """Quote a SQL identifier with double quotes (escape embedded quotes)."""
    return '"' + ident.replace('"', '""') + '"'


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------

def table_exists(conn: sqlite3.Connection, table: str) -> bool:
    cur = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table,),
    )
    return cur.fetchone() is not None


def table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    try:
        cur = conn.execute(f"PRAGMA table_info({q(table)})")
        return [r[1] for r in cur.fetchall()]
    except sqlite3.Error:
        return []


def has_market_column(conn: sqlite3.Connection, table: str) -> bool:
    return "market" in table_columns(conn, table)


# ---------------------------------------------------------------------------
# Deletion planning
# ---------------------------------------------------------------------------

def build_where_clause(
    conn: sqlite3.Connection,
    table: str,
) -> Tuple[str, List[str]]:
    """
    Build the WHERE clause + bind params that select all polluted rows in
    `table`. The clause always includes:
      - ticker IN (<gulf set>)
      - ticker GLOB '[0-9]*'      (any ticker starting with a digit)
    and, if the table has a `market` column:
      - market IN ('TADAWUL','KSE','QSE',...)
    """
    params: List[str] = []
    parts: List[str] = []

    # 1) Known Gulf/Kuwaiti tickers
    placeholders = ",".join("?" * len(KUWAIT_GULF_TICKERS))
    parts.append(f"{q('ticker')} IN ({placeholders})")
    params.extend(KUWAIT_GULF_TICKERS)

    # 2) Any ticker starting with a digit (Saudi TADAWUL numeric tickers)
    parts.append(f"{q('ticker')} GLOB '[0-9]*'")

    # 3) Wrong-market rows
    if has_market_column(conn, table):
        m_placeholders = ",".join("?" * len(NON_EGX_MARKETS))
        parts.append(f"{q('market')} IN ({m_placeholders})")
        params.extend(NON_EGX_MARKETS)

    clause = " OR ".join(parts)
    return clause, params


def count_polluted(
    conn: sqlite3.Connection, table: str
) -> Tuple[int, List[Dict[str, object]]]:
    """Return (count, sample_rows) of polluted rows in `table`."""
    if not table_exists(conn, table):
        return 0, []
    where, params = build_where_clause(conn, table)
    try:
        cnt = conn.execute(
            f"SELECT COUNT(*) FROM {q(table)} WHERE {where}", params
        ).fetchone()[0]
    except sqlite3.Error as e:
        print(f"    ERROR counting {table}: {e}")
        return 0, []
    sample: List[Dict[str, object]] = []
    if cnt > 0:
        cols = table_columns(conn, table)
        select_cols = ", ".join(q(c) for c in cols[:6])  # first 6 cols for preview
        try:
            cur = conn.execute(
                f"SELECT {select_cols} FROM {q(table)} WHERE {where} LIMIT 10",
                params,
            )
            for row in cur.fetchall():
                sample.append(dict(zip(cols[:6], row)))
        except sqlite3.Error:
            pass
    return cnt, sample


def apply_purge(
    conn: sqlite3.Connection, table: str
) -> Tuple[int, int]:
    """
    Apply the purge to `table`. Returns (deleted_count, deactivated_count).

    For SOFT_TABLES we UPDATE is_active=0 (no DELETE).
    For every other table we DELETE the polluted rows.
    """
    where, params = build_where_clause(conn, table)
    if table in SOFT_TABLES:
        cur = conn.execute(
            f"UPDATE {q(table)} SET is_active = 0 WHERE {where}",
            params,
        )
        return 0, cur.rowcount
    cur = conn.execute(f"DELETE FROM {q(table)} WHERE {where}", params)
    return cur.rowcount, 0


# ---------------------------------------------------------------------------
# Per-database processing
# ---------------------------------------------------------------------------

def process_database(db_path: Path, apply: bool) -> Dict[str, int]:
    """
    Process one database. Returns a dict of {table: rows_affected}.
    """
    if not db_path.exists():
        print(f"\nNOTE: database file not found: {db_path} — skipping.")
        return {}

    db_name = db_path.name
    tables = DB_TABLES.get(db_name, [])
    if not tables:
        print(f"\nNOTE: no tables configured for {db_name} — skipping.")
        return {}

    print(f"\n{'=' * 70}")
    print(f"DATABASE: {db_name}  ({db_path})")
    print(f"{'=' * 70}")

    conn = sqlite3.connect(str(db_path))
    conn.isolation_level = None  # manual BEGIN/COMMIT
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
    except sqlite3.Error:
        pass

    results: Dict[str, int] = {}

    # ── Dry-run scan ───────────────────────────────────────────────────────
    print(f"\n[SCAN MODE: {'APPLY' if apply else 'DRY-RUN'}]")
    planned: List[Tuple[str, int, List[Dict[str, object]]]] = []
    for table in tables:
        if not table_exists(conn, table):
            print(f"  [{table}] table not found — skipping.")
            continue
        cnt, sample = count_polluted(conn, table)
        action = "DEACTIVATE" if table in SOFT_TABLES else "DELETE"
        if cnt == 0:
            print(f"  [{table}] no polluted rows found.")
            results[table] = 0
            continue
        print(f"  [{table}] {cnt} row(s) to {action}:")
        for s in sample[:10]:
            preview = {k: s[k] for k in list(s)[:4]}
            print(f"      {preview}")
        if cnt > 10:
            print(f"      ... and {cnt - 10} more")
        planned.append((table, cnt, sample))
        results[table] = cnt

    # ── Apply ──────────────────────────────────────────────────────────────
    if apply and planned:
        backup_path = db_path.with_name(db_path.name + ".bak.purge-non-egx")
        print(f"\nBacking up {db_name} -> {backup_path.name}")
        try:
            shutil.copy2(str(db_path), str(backup_path))
        except OSError as e:
            print(f"  ERROR: backup failed ({e}); aborting apply for this DB.")
            conn.close()
            return {t: 0 for t, _, _ in planned}

        try:
            conn.execute("BEGIN")
            total_del = 0
            total_deact = 0
            for table, cnt, _ in planned:
                deleted, deactivated = apply_purge(conn, table)
                action = "DEACTIVATED" if table in SOFT_TABLES else "DELETED"
                print(f"  [{table}] {action} {deleted + deactivated} row(s).")
                total_del += deleted
                total_deact += deactivated
            conn.execute("COMMIT")
            print(
                f"  COMMITTED: {total_del} deleted, {total_deact} deactivated "
                f"in {db_name}."
            )
            # Update results with actual applied counts
            for table, _, _ in planned:
                # Re-count to confirm
                cnt_after, _ = count_polluted(conn, table)
                results[table] = (results[table] or 0) - cnt_after
        except sqlite3.Error as e:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            print(f"  ERROR during apply — transaction rolled back: {e}")
            results = {t: 0 for t, _, _ in planned}
    elif apply and not planned:
        print(f"  (nothing to apply for {db_name})")

    conn.close()
    return results


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="purge_non_egx_stocks.py",
        description=(
            "Purge Saudi/Kuwaiti/Gulf stocks from EGX cache tables. "
            "Default mode is DRY-RUN (no writes)."
        ),
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Backs up each DB to <db>.bak.purge-non-egx and "
             "wraps all deletes in one transaction per DB (rollback on error).",
    )
    p.add_argument(
        "--db",
        choices=list(DB_TABLES.keys()),
        default=None,
        help="Limit to a single database (e.g. 'stocks.db' or 'predictions.db').",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    print("=" * 70)
    print("PURGE NON-EGX STOCKS — cache cleanup script")
    print(
        "Mode: "
        + ("APPLY (backup + transaction)" if args.apply else "DRY-RUN (no writes)")
    )
    if args.db:
        print(f"Limiting to: {args.db}")
    print(f"Known Gulf/Kuwaiti tickers: {len(KUWAIT_GULF_TICKERS)}")
    print(f"Non-EGX markets: {NON_EGX_MARKETS}")
    print("=" * 70)

    targets = [args.db] if args.db else list(DB_TABLES.keys())

    grand_results: Dict[str, Dict[str, int]] = {}
    for db_name in targets:
        db_path = DB_DIR / db_name
        grand_results[db_name] = process_database(db_path, args.apply)

    # ── Summary ────────────────────────────────────────────────────────────
    print("\n" + "=" * 70)
    print("SUMMARY")
    print("=" * 70)
    grand_total = 0
    for db_name, table_counts in grand_results.items():
        db_total = sum(table_counts.values())
        grand_total += db_total
        print(f"  {db_name}:")
        for table, n in table_counts.items():
            action = "deactivated" if table in SOFT_TABLES else "deleted"
            label = "would be " + action if not args.apply else action
            print(f"    {table:<24} {n:>6} rows {label}")
        print(f"    {'TOTAL':<24} {db_total:>6}")
    print(f"\n  GRAND TOTAL: {grand_total} row(s) "
          + ("affected" if args.apply else "would be affected"))
    if not args.apply and grand_total > 0:
        print("\n  Re-run with --apply to actually delete/deactivate the rows.")
    elif grand_total == 0:
        print("\n  Nothing to purge — caches are already clean.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
