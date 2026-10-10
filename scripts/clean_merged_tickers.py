#!/usr/bin/env python3
"""
Database cleanup script for merged ticker symbols.
سكريبت تنظيف قاعدة البيانات لإصلاح الرموز الملتصقة بالأسماء.

English:
    The TradingView scraper merged the ticker symbol with the company name
    (plus a trailing "D") into the `ticker` / `symbol` column. Examples:
        "LUTSLotus For Agricultural...D"  ->  "LUTS"
        "CPMECatalyst...D"                ->  "CPME"
        "RMDARmda...D"                    ->  "RMDA"
    This script scans every table that has a `ticker` column (and the
    `stocks` table's `symbol` column too) in:
        - /home/z/my-project/db/stocks.db
        - /home/z/my-project/db/predictions.db
    and either REPORTS (dry-run, default) or REWRITES (with --apply) the
    polluted values, using the SAME logic as the frontend `formatCleanTicker`
    function in src/components/stocks/StocksView.tsx.

Arabic / العربية:
    سكريبت يصلح الرموز الملتصقة بالأسماء في قواعد بيانات stocks.db و
    predictions.db. الـ scraper بتاع TradingView دمج رمز السهم مع اسم الشركة
    plus حرف D في آخره في عمود ticker/symbol. السكريبت ده بيصلح المشكلة دي
    بنفس منطق دالة formatCleanTicker الموجودة في الـ frontend.

Usage:
    python3 scripts/clean_merged_tickers.py            # dry-run report only
    python3 scripts/clean_merged_tickers.py --apply    # apply (backup + transaction)
    python3 scripts/clean_merged_tickers.py --db stocks.db
    python3 scripts/clean_merged_tickers.py --db predictions.db --apply
"""

from __future__ import annotations

import argparse
import re
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

# Databases to scan, in priority order.
DATABASES: List[str] = ["stocks.db", "predictions.db"]

# Mirrors the frontend regex in src/components/stocks/StocksView.tsx:
#   if (rawTicker.length > 6) { const m = rawTicker.match(/^[A-Z]{2,6}/); ... }
UPPER_PREFIX_RE = re.compile(r"^[A-Z]{2,6}")
PURE_NUMBER_RE = re.compile(r"^\d+$")

# Identifier-quote helper to safely handle arbitrary table / column names.
def q(ident: str) -> str:
    """Quote a SQL identifier with double quotes (and escape embedded quotes)."""
    return '"' + ident.replace('"', '""') + '"'


# ---------------------------------------------------------------------------
# Ticker cleaning logic — mirrors frontend `formatCleanTicker`
# ---------------------------------------------------------------------------

def format_clean_ticker(raw: str) -> str:
    """
    Mirror of the frontend `formatCleanTicker` function
    (src/components/stocks/StocksView.tsx).

    - Empty input  -> empty string.
    - Length <= 6  -> returned unchanged.
    - Length > 6   -> match `^[A-Z]{2,6}` then trim the trailing capital that
                      begins a CamelCase word. e.g. "LUTSLotus..." greedy-matches
                      "LUTSL" but "Lotus" starts with a capital L, so the char
                      after the match is lowercase 'o' → drop the last 'L' → "LUTS".
                      Same for "CPMECatalyst..." → "CPME", "RMDARmda..." → "RMDA".
    """
    if not raw:
        return raw
    if len(raw) <= 6:
        return raw
    m = UPPER_PREFIX_RE.match(raw)
    if not m:
        return raw
    clean = m.group(0)
    # Trim trailing capital that begins a CamelCase word (next char is lowercase)
    while len(clean) > 2 and len(clean) < len(raw):
        nxt = raw[len(clean)]
        if nxt.islower():
            clean = clean[:-1]
        else:
            break
    return clean


def is_pure_number(value: str) -> bool:
    """Return True for pure-numeric tickers (e.g. Saudi TADAWUL '2120')."""
    return bool(value) and PURE_NUMBER_RE.match(value.strip()) is not None


def is_already_clean(value: str) -> bool:
    """
    A ticker is "already clean" if:
      - it is empty, OR
      - length <= 6 AND it is all uppercase ASCII letters.
    These rows are skipped (no change needed).
    """
    if not value:
        return True
    if len(value) > 6:
        return False
    return value.isalpha() and value.isupper()


# ---------------------------------------------------------------------------
# SQLite schema helpers
# ---------------------------------------------------------------------------

def get_table_columns(conn: sqlite3.Connection, table: str) -> List[str]:
    """Return the list of column names for `table` (empty list if missing)."""
    try:
        cur = conn.execute(f"PRAGMA table_info({q(table)})")
        return [r[1] for r in cur.fetchall()]
    except sqlite3.Error:
        return []


def get_primary_key(conn: sqlite3.Connection, table: str) -> Optional[str]:
    """
    Return a single-column primary key name for `table`, or None.
    Falls back to a column literally named `id` if no PK is declared.
    """
    try:
        cur = conn.execute(f"PRAGMA table_info({q(table)})")
        rows = cur.fetchall()
    except sqlite3.Error:
        return None
    pk_cols = [r[1] for r in rows if r[5] > 0]  # column `pk` (index 5) > 0
    if len(pk_cols) == 1:
        return pk_cols[0]
    # Fallback: look for an `id` column.
    cols = [r[1] for r in rows]
    if "id" in cols:
        return "id"
    return None


def columns_to_scan(conn: sqlite3.Connection, table: str) -> List[str]:
    """
    Decide which columns to scan for ticker pollution in this table.
      - `stocks` table: scan both `ticker` and `symbol` (if they exist).
      - Every other table: scan only `ticker` (if it exists).
    """
    cols = get_table_columns(conn, table)
    result: List[str] = []
    if table == "stocks":
        for c in ("ticker", "symbol"):
            if c in cols and c not in result:
                result.append(c)
    else:
        if "ticker" in cols:
            result.append("ticker")
    return result


# ---------------------------------------------------------------------------
# Update planning
# ---------------------------------------------------------------------------

# An Update is a tuple of (pk_value, old_value, new_value).
Update = Tuple[object, str, str]


def plan_column_updates(
    conn: sqlite3.Connection,
    db_name: str,
    table: str,
    col: str,
) -> Tuple[List[Update], List[str], Optional[str]]:
    """
    Build the list of updates for one (table, col) pair.

    Returns (updates, warnings, pk_col).
      - updates:   list of (pk_value, old_value, new_value) to apply.
      - warnings:  human-readable warning strings (e.g. collision skips).
      - pk_col:    the primary key column used in the WHERE clause (None if
                   no usable PK was found, in which case `updates` is empty).
    """
    pk = get_primary_key(conn, table)
    if pk is None:
        return (
            [],
            [f"  NOTE: no usable primary key on '{table}' — skipping this table."],
            None,
        )

    # Load all distinct current values for collision detection.
    try:
        cur = conn.execute(
            f"SELECT DISTINCT {q(col)} FROM {q(table)} WHERE {q(col)} IS NOT NULL"
        )
        existing_values = {
            row[0] for row in cur.fetchall() if isinstance(row[0], str)
        }
    except sqlite3.Error as e:
        return (
            [],
            [f"  ERROR reading distinct values from {table}.{col}: {e}"],
            pk,
        )

    # Load all (pk, value) pairs to evaluate.
    try:
        cur = conn.execute(
            f"SELECT {q(pk)}, {q(col)} FROM {q(table)} WHERE {q(col)} IS NOT NULL"
        )
        rows = cur.fetchall()
    except sqlite3.Error as e:
        return (
            [],
            [f"  ERROR reading rows from {table}.{col}: {e}"],
            pk,
        )

    updates: List[Update] = []
    warnings: List[str] = []
    for pk_value, old_value in rows:
        if not isinstance(old_value, str):
            continue
        # Skip rows that don't need touching.
        if is_already_clean(old_value):
            continue
        if is_pure_number(old_value):
            continue
        new_value = format_clean_ticker(old_value)
        if new_value == old_value:
            # The format function didn't change it (e.g. no uppercase prefix).
            continue
        # Collision check: would `new_value` clash with an existing ticker
        # in the same column? (Counts both pre-existing rows AND in-flight
        # updates we've already committed to in this planning pass.)
        if new_value in existing_values:
            warnings.append(
                f"  WARNING: SKIP row pk={pk_value!r} in {db_name}.{table}.{col}: "
                f"'{old_value}' -> '{new_value}' would collide with an existing "
                f"ticker; leaving unchanged."
            )
            continue
        updates.append((pk_value, old_value, new_value))
        # Reserve the new value so subsequent polluted rows targeting the
        # same clean ticker also skip (prevents creating new duplicates).
        existing_values.add(new_value)

    return updates, warnings, pk


# ---------------------------------------------------------------------------
# Per-database processing
# ---------------------------------------------------------------------------

# TableReport collects everything needed to apply updates for one (table, col).
TableReport = Tuple[str, str, List[Update], str]  # (table, col, updates, pk_col)


def list_tables(conn: sqlite3.Connection) -> List[str]:
    """Return all user tables in creation order, excluding sqlite_* internals."""
    try:
        cur = conn.execute(
            "SELECT name FROM sqlite_master WHERE type='table' "
            "AND name NOT LIKE 'sqlite_%' ORDER BY name"
        )
        return [r[0] for r in cur.fetchall()]
    except sqlite3.Error as e:
        print(f"  ERROR listing tables: {e}")
        return []


def process_database(db_path: Path, apply: bool) -> Tuple[List[TableReport], int]:
    """
    Process a single database file. Returns (table_reports, total_update_count).

    In dry-run mode `table_reports` is still populated (for the summary), but
    no writes occur. In apply mode, all updates across all tables in this DB
    run inside a single transaction (BEGIN/COMMIT, ROLLBACK on error), and a
    backup is written to `<db>.bak.clean-tickers` before any writes.
    """
    if not db_path.exists():
        print(f"\nNOTE: database file not found: {db_path} — skipping.")
        return [], 0

    print(f"\n{'=' * 70}")
    print(f"DATABASE: {db_path.name}  ({db_path})")
    print(f"{'=' * 70}")

    # Use autocommit isolation level so we can manage BEGIN/COMMIT/ROLLBACK
    # explicitly (the Python sqlite3 module otherwise auto-opens transactions
    # in surprising ways).
    conn = sqlite3.connect(str(db_path))
    conn.isolation_level = None
    # Disable FK enforcement during cleanup so updating a PK referenced by
    # another table (e.g. stocks.ticker <- stock_daily_prices.ticker) does
    # not abort the transaction. All FK targets are updated in the same pass.
    try:
        conn.execute("PRAGMA foreign_keys=OFF")
    except sqlite3.Error:
        pass

    tables = list_tables(conn)
    table_reports: List[TableReport] = []
    total_updates = 0

    for table in tables:
        cols = columns_to_scan(conn, table)
        if not cols:
            continue
        for col in cols:
            updates, warnings, pk = plan_column_updates(conn, db_path.name, table, col)
            for w in warnings:
                print(w)
            if not updates:
                print(f"  [{table}.{col}] no merged tickers found.")
                continue
            print(f"  [{table}.{col}] {len(updates)} row(s) need cleaning:")
            for pk_value, old_value, new_value in updates:
                print(f"    pk={pk_value!r}:  '{old_value}'  ->  '{new_value}'")
            table_reports.append((table, col, updates, pk))
            total_updates += len(updates)

    if apply and table_reports:
        backup_path = db_path.with_name(db_path.name + ".bak.clean-tickers")
        print(f"\nBacking up {db_path.name} -> {backup_path.name}")
        try:
            shutil.copy2(str(db_path), str(backup_path))
        except OSError as e:
            print(f"  ERROR: backup failed ({e}); aborting apply for this DB.")
            conn.close()
            return [], 0

        try:
            conn.execute("BEGIN")
            applied = 0
            for table, col, updates, pk in table_reports:
                for pk_value, old_value, new_value in updates:
                    conn.execute(
                        f"UPDATE {q(table)} SET {q(col)} = ? WHERE {q(pk)} = ?",
                        (new_value, pk_value),
                    )
                    applied += 1
            conn.execute("COMMIT")
            print(f"  COMMITTED {applied} update(s) to {db_path.name}.")
        except sqlite3.Error as e:
            try:
                conn.execute("ROLLBACK")
            except sqlite3.Error:
                pass
            print(f"  ERROR during apply — transaction rolled back: {e}")
            total_updates = 0
            table_reports = []
    elif apply:
        print(f"  (nothing to apply for {db_path.name})")

    conn.close()
    return table_reports, total_updates


# ---------------------------------------------------------------------------
# CLI
# ---------------------------------------------------------------------------

def build_arg_parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(
        prog="clean_merged_tickers.py",
        description=(
            "Clean merged ticker symbols (e.g. 'LUTSLotus...D' -> 'LUTS') in "
            "stocks.db and predictions.db. Default mode is DRY-RUN."
        ),
    )
    p.add_argument(
        "--apply",
        action="store_true",
        help="Apply changes. Backs up each DB to <db>.bak.clean-tickers and "
             "wraps all updates in one transaction per DB (rollback on error).",
    )
    p.add_argument(
        "--db",
        choices=DATABASES,
        default=None,
        help="Limit to a single database (e.g. 'stocks.db' or 'predictions.db').",
    )
    return p


def main(argv: Optional[List[str]] = None) -> int:
    args = build_arg_parser().parse_args(argv)

    print("=" * 70)
    print("CLEAN MERGED TICKERS — DB cleanup script")
    print(
        "Mode: "
        + ("APPLY (backup + transaction)" if args.apply else "DRY-RUN (no writes)")
    )
    if args.db:
        print(f"Limiting to: {args.db}")
    print("=" * 70)

    targets = [args.db] if args.db else list(DATABASES)

    grand_total = 0
    grand_tables = 0
    for db_name in targets:
        db_path = DB_DIR / db_name
        reports, n = process_database(db_path, args.apply)
        grand_total += n
        grand_tables += len(reports)

    print("\n" + "=" * 70)
    if args.apply:
        print(f"SUMMARY: Updated {grand_total} row(s) across {grand_tables} table(s).")
    else:
        print(f"SUMMARY: Would update {grand_total} row(s) across {grand_tables} table(s).")
        if grand_total > 0:
            print("Re-run with --apply to actually write the changes.")
        else:
            print("Nothing to clean — all ticker columns are already tidy.")
    print("=" * 70)
    return 0


if __name__ == "__main__":
    sys.exit(main())
