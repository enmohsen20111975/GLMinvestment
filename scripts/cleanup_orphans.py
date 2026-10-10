#!/usr/bin/env python3
"""
cleanup_orphans.py — Orphan Record Cleanup for predictions.db + stocks.db
=========================================================================
(Phase B — P14-PHASE-B-INTEGRITY — DATA-02 + DATA-05 remediation)

WHAT THIS SCRIPT DOES / هذا السكريبت بيعمل إيه
------------------------------------------------
SQLite has `PRAGMA foreign_keys=ON` OFF by default, which allowed orphaned
records to accumulate in `predictions.db` — rows whose `ticker` does not
exist in `stocks.db.stocks`. The Deep Audit (AUDIT_REPORT.md, DATA-02)
found a real orphan: ticker `MFRC` in `predictions` but missing from
`stocks`. Phase A (P13-CRITICAL-HOTFIX) closed the source of the leak by
enabling foreign keys per-connection; Phase B (this script) cleans up
the orphans that already accumulated.

SQLite بتكون `PRAGMA foreign_keys=ON` OFF افتراضياً، ده خلّى سجلات يتيمة
تتراكم في `predictions.db` — صفوف الـ `ticker` بتاعها مش موجود في
`stocks.db.stocks`. الـ Deep Audit لقى orphan حقيقي: ticker `MFRC` في
`predictions` بس مش موجود في `stocks`. Phase A قفلت مصدر التسرّب، Phase B
(السكريبت ده) بينظّف اليتامى اللي متراكمين فعلاً.

This script:
  1. Scans `predictions.db` tables (`predictions`, `stored_analyses`,
     `persona_predictions`) for rows whose `ticker` is NOT in
     `stocks.db.stocks` (cross-DB check via ATTACH).
  2. Scans `prediction_outcomes` (within the same DB) for rows whose
     `prediction_id` is NOT in `predictions.id` (internal orphan).
  3. Prints a clear report (sample orphans + counts) — ALWAYS first.
  4. In `--execute` mode: DELETEs the orphans OR marks them `is_active=0`
     (depending on `--action`).

USAGE / الاستخدام
-----------------
  # Default: dry-run scan only — safe, no changes / افتراضي: فحص بدون تعديل
  python3 scripts/cleanup_orphans.py

  # Execute deletion of orphan rows / امسح اليتامى فعلياً
  python3 scripts/cleanup_orphans.py --execute --action delete

  # Mark orphans inactive instead of deleting / علّم اليتامى is_active=0 بدل المسح
  python3 scripts/cleanup_orphans.py --execute --action mark

  # Use a custom DB directory / استخدم مجلد DB مختلف
  python3 scripts/cleanup_orphans.py --db-dir /path/to/db

SAFETY / الضمانات
-----------------
  - DEFAULT is always `--dry-run`. Never modifies data without `--execute`.
  - Parameterized queries only (no f-string SQL for values). Table/column
    names come from a fixed allowlist in code, never from user input.
  - `PRAGMA foreign_keys=ON` on every connection.
  - `stocks.db` is attached READ-ONLY (defense in depth — we only ever
    write to `predictions.db`).
  - Connections closed in `finally` blocks.
  - Each table's cleanup is wrapped in its own `try/except` + transaction
    so one failure doesn't block the others.
  - Exit code: 0 on success, 1 on error.

PART OF: Phase B (P14-PHASE-B-INTEGRITY) — Data Integrity remediation.
Context: AUDIT_REPORT.md (DATA-02 + DATA-05) + worklog.md (P13-CRITICAL-HOTFIX).

Author: P14-TASK-4 (general-purpose agent)
"""
from __future__ import annotations

import argparse
import sqlite3
import sys
from dataclasses import dataclass, field
from datetime import datetime
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

# ---------------------------------------------------------------------------
# Path auto-detection / اكتشاف المسارات تلقائياً
# ---------------------------------------------------------------------------
SCRIPT_DIR: Path = Path(__file__).resolve().parent
PROJECT_ROOT: Path = SCRIPT_DIR.parent
DEFAULT_DB_DIR: Path = PROJECT_ROOT / "db"

STOCKS_DB_FILENAME: str = "stocks.db"
PREDICTIONS_DB_FILENAME: str = "predictions.db"

# Max orphan rows to print as samples per table
MAX_SAMPLES: int = 10

# ---------------------------------------------------------------------------
# Scan configuration / إعدادات الفحص
# ---------------------------------------------------------------------------
# Tables in predictions.db whose `ticker` must exist in stocks.db.stocks.
# For each: (table_name, candidate "signal" columns to display in samples).
TICKER_TABLES: List[Tuple[str, List[str]]] = [
    ("predictions",         ["signal", "signal_type"]),
    ("stored_analyses",     ["recommendation", "recommendation_ar"]),
    ("persona_predictions", ["signal_type", "persona_type"]),
]

# Tables with internal FK inside predictions.db.
# (table, fk_column, ref_table, ref_column)
INTERNAL_FK_TABLES: List[Tuple[str, str, str, str]] = [
    ("prediction_outcomes", "prediction_id", "predictions", "id"),
]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def log(msg: str) -> None:
    """Print a timestamped log line to stderr."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print(f"[{ts}] {msg}", file=sys.stderr)


def table_exists(conn: sqlite3.Connection, table_name: str) -> bool:
    """Check if a table exists in the main DB (not attached)."""
    row = conn.execute(
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (table_name,),
    ).fetchone()
    return row is not None


def table_columns(conn: sqlite3.Connection, table_name: str) -> List[str]:
    """Return column names for a table (PRAGMA table_info)."""
    # table_name comes from a hard-coded allowlist, safe to interpolate.
    return [r[1] for r in conn.execute(f"PRAGMA table_info({table_name})")]


def pick_display_col(
    conn: sqlite3.Connection, table: str, candidates: List[str]
) -> Optional[str]:
    """Pick the first existing column from candidates (for sample display)."""
    cols = set(table_columns(conn, table))
    for c in candidates:
        if c in cols:
            return c
    return None


def open_predictions_conn(
    predictions_db: Path,
    stocks_db: Path,
    writable: bool = False,
) -> sqlite3.Connection:
    """
    Open predictions.db with foreign_keys=ON and attach stocks.db READ-ONLY.

    Args:
        predictions_db: Path to predictions.db (writable when writable=True).
        stocks_db: Path to stocks.db (always attached read-only).
        writable: True if write operations will be performed.

    Returns:
        sqlite3.Connection with stocks.db attached as schema `stocks_db`.
    """
    conn = sqlite3.connect(str(predictions_db), timeout=30.0, uri=True)
    conn.row_factory = sqlite3.Row
    # Critical: enable FK enforcement on THIS connection (DATA-02 fix).
    conn.execute("PRAGMA foreign_keys=ON")
    conn.execute("PRAGMA busy_timeout=30000")
    if writable:
        conn.execute("PRAGMA journal_mode=WAL")
        conn.execute("PRAGMA synchronous=NORMAL")

    # Attach stocks.db READ-ONLY — we never write to it. / نقرأ منه فقط.
    # URI form `file:<path>?mode=ro` requires uri=True on connect (set above).
    stocks_uri = f"file:{stocks_db}?mode=ro"
    conn.execute("ATTACH DATABASE ? AS stocks_db", (stocks_uri,))
    return conn


# ---------------------------------------------------------------------------
# Scan / الفحص
# ---------------------------------------------------------------------------
@dataclass
class TableReport:
    """Per-table scan result."""
    table: str
    total: int = 0
    orphan_count: int = 0
    samples: List[Dict[str, Any]] = field(default_factory=list)
    # Metadata for execute phase
    orphan_reason: str = ""            # human-readable reason
    delete_where_sql: str = ""         # SQL fragment for DELETE/UPDATE WHERE clause
    display_signal_col: Optional[str] = None  # column used to display "signal" in samples
    error: Optional[str] = None
    skipped: bool = False              # True if table missing


def scan_ticker_table(
    conn: sqlite3.Connection, table: str, signal_candidates: List[str]
) -> TableReport:
    """Scan a ticker-based table for orphans (ticker not in stocks.db.stocks)."""
    rpt = TableReport(table=table)
    if not table_exists(conn, table):
        log(f"⚠️  Table '{table}' not found in predictions.db — skipping.")
        rpt.skipped = True
        return rpt

    signal_col = pick_display_col(conn, table, signal_candidates)
    rpt.display_signal_col = signal_col

    cols = set(table_columns(conn, table))
    rpt.total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]

    # Cross-DB LEFT JOIN: rows whose ticker has no match in stocks.db.stocks.
    # NULL tickers also surface here (NULL doesn't match anything) — those
    # are legitimately orphans too (a prediction without a valid ticker).
    rpt.orphan_count = conn.execute(
        f"SELECT COUNT(*) FROM {table} p "
        f"LEFT JOIN stocks_db.stocks s ON p.ticker = s.ticker "
        f"WHERE s.ticker IS NULL"
    ).fetchone()[0]
    rpt.orphan_reason = "ticker not in stocks"
    rpt.delete_where_sql = (
        f"ticker NOT IN (SELECT ticker FROM stocks_db.stocks)"
    )

    # Build sample rows for display
    if rpt.orphan_count > 0:
        select_cols = ["p.id", "p.ticker"]
        if signal_col:
            select_cols.append(f"p.{signal_col}")
        if "created_at" in cols:
            select_cols.append("p.created_at")
        select_sql = ", ".join(select_cols)
        sample_rows = conn.execute(
            f"SELECT {select_sql} FROM {table} p "
            f"LEFT JOIN stocks_db.stocks s ON p.ticker = s.ticker "
            f"WHERE s.ticker IS NULL LIMIT ?",
            (MAX_SAMPLES,),
        ).fetchall()
        for r in sample_rows:
            rpt.samples.append({
                "id": r["id"] if "id" in r.keys() else None,
                "ticker": r["ticker"],
                "signal": r[signal_col] if signal_col and signal_col in r.keys() else None,
                "created_at": r["created_at"] if "created_at" in r.keys() else None,
            })
    return rpt


def scan_internal_fk_table(
    conn: sqlite3.Connection,
    table: str,
    fk_col: str,
    ref_table: str,
    ref_col: str,
) -> TableReport:
    """Scan a table for orphans based on an internal FK (same DB)."""
    rpt = TableReport(table=table)
    if not table_exists(conn, table):
        log(f"⚠️  Table '{table}' not found in predictions.db — skipping.")
        rpt.skipped = True
        return rpt
    if not table_exists(conn, ref_table):
        log(f"⚠️  Reference table '{ref_table}' not found — skipping '{table}'.")
        rpt.skipped = True
        return rpt

    rpt.total = conn.execute(f"SELECT COUNT(*) FROM {table}").fetchone()[0]
    rpt.orphan_count = conn.execute(
        f"SELECT COUNT(*) FROM {table} o "
        f"LEFT JOIN {ref_table} p ON o.{fk_col} = p.{ref_col} "
        f"WHERE p.{ref_col} IS NULL"
    ).fetchone()[0]
    rpt.orphan_reason = f"{fk_col} not in {ref_table}.{ref_col}"
    rpt.delete_where_sql = (
        f"{fk_col} NOT IN (SELECT {ref_col} FROM {ref_table})"
    )

    if rpt.orphan_count > 0:
        sample_rows = conn.execute(
            f"SELECT o.id AS oid, o.{fk_col} AS fk_val FROM {table} o "
            f"LEFT JOIN {ref_table} p ON o.{fk_col} = p.{ref_col} "
            f"WHERE p.{ref_col} IS NULL LIMIT ?",
            (MAX_SAMPLES,),
        ).fetchall()
        for r in sample_rows:
            rpt.samples.append({
                "id": r["oid"],
                "fk_label": fk_col,
                "fk_value": r["fk_val"],
            })
    return rpt


def scan_all(conn: sqlite3.Connection) -> List[TableReport]:
    """Run all orphan scans; returns one TableReport per table in order."""
    reports: List[TableReport] = []
    for table, signal_candidates in TICKER_TABLES:
        try:
            reports.append(scan_ticker_table(conn, table, signal_candidates))
        except Exception as e:
            rpt = TableReport(table=table, error=str(e))
            log(f"❌ Error scanning {table}: {e}")
            reports.append(rpt)
    for table, fk_col, ref_table, ref_col in INTERNAL_FK_TABLES:
        try:
            reports.append(
                scan_internal_fk_table(conn, table, fk_col, ref_table, ref_col)
            )
        except Exception as e:
            rpt = TableReport(table=table, error=str(e))
            log(f"❌ Error scanning {table}: {e}")
            reports.append(rpt)
    return reports


# ---------------------------------------------------------------------------
# Report printing / طباعة التقرير
# ---------------------------------------------------------------------------
def print_report(
    reports: List[TableReport],
    mode: str,
    action: str,
    predictions_db: Path,
    stocks_db: Path,
) -> int:
    """Print the human-readable orphan report. Returns total orphan count."""
    ts = datetime.now().strftime("%Y-%m-%d %H:%M:%S")
    print()
    print("=" * 60)
    print(f"  ORPHAN CLEANUP REPORT — {ts}")
    print("=" * 60)
    print(f"predictions.db: {predictions_db}")
    print(f"stocks.db:      {stocks_db}")
    print()

    total_orphans = 0
    for rpt in reports:
        if rpt.skipped:
            print(f"  {rpt.table} table:")
            print(f"    ⚠️  SKIPPED (table not found)")
            print()
            continue
        if rpt.error:
            print(f"  {rpt.table} table:")
            print(f"    ❌ ERROR during scan: {rpt.error}")
            print()
            continue

        print(f"  {rpt.table} table:")
        print(f"    Total rows: {rpt.total}")
        print(f"    Orphaned rows ({rpt.orphan_reason}): {rpt.orphan_count}")

        if rpt.samples:
            print("    Sample orphans:")
            for s in rpt.samples:
                # Ticker-table sample format
                if "ticker" in s:
                    parts = []
                    if s.get("id") is not None:
                        parts.append(f"id={s['id']}")
                    parts.append(f"ticker={s['ticker']}")
                    if s.get("signal") is not None:
                        parts.append(f"signal={s['signal']}")
                    if s.get("created_at"):
                        parts.append(f"created_at={s['created_at']}")
                    print(f"      - {', '.join(parts)}")
                # Internal-FK sample format
                elif "fk_label" in s:
                    print(f"      - id={s.get('id')}, {s['fk_label']}={s['fk_value']}")
            if rpt.orphan_count > MAX_SAMPLES:
                print(f"      ... ({rpt.orphan_count - MAX_SAMPLES} more)")
        print()
        total_orphans += rpt.orphan_count

    print("=" * 60)
    print(f"  TOTAL ORPHANS FOUND: {total_orphans}")
    if mode == "EXECUTE":
        print(f"  MODE: EXECUTE (--action={action})")
    else:
        print(f"  MODE: DRY-RUN (no changes made)")
        print("  To execute: re-run with --execute")
    print("=" * 60)
    return total_orphans


# ---------------------------------------------------------------------------
# Execute cleanup / التنفيذ
# ---------------------------------------------------------------------------
def execute_cleanup(
    conn: sqlite3.Connection,
    reports: List[TableReport],
    action: str,
) -> Dict[str, int]:
    """
    Perform the actual cleanup (delete or mark) per-table.
    Each table is wrapped in its own transaction + try/except.
    Returns dict {table_name: rows_affected_or_-1_on_error}.
    """
    results: Dict[str, int] = {}

    for rpt in reports:
        if rpt.skipped or rpt.error:
            results[rpt.table] = 0
            continue
        if rpt.orphan_count == 0:
            results[rpt.table] = 0
            continue
        if not rpt.delete_where_sql:
            # Defensive: no WHERE clause built — skip rather than risk a
            # catastrophic DELETE without a WHERE.
            log(f"⚠️  {rpt.table}: no WHERE clause built — skipping.")
            results[rpt.table] = 0
            continue

        table = rpt.table
        where_sql = rpt.delete_where_sql

        try:
            conn.execute("BEGIN")
            if action == "delete":
                # DELETE orphan rows
                cur = conn.execute(f"DELETE FROM {table} WHERE {where_sql}")
                affected = cur.rowcount
                conn.commit()
                results[table] = affected
                log(f"  ✓ {table}: deleted {affected} orphan rows")
            elif action == "mark":
                # Add is_active column if missing, then mark orphans is_active=0
                cols = set(table_columns(conn, table))
                if "is_active" not in cols:
                    conn.execute(
                        f"ALTER TABLE {table} "
                        f"ADD COLUMN is_active INTEGER DEFAULT 1"
                    )
                    log(f"  ✓ {table}: added is_active column (DEFAULT 1)")
                cur = conn.execute(
                    f"UPDATE {table} SET is_active=0 WHERE {where_sql}"
                )
                affected = cur.rowcount
                conn.commit()
                results[table] = affected
                log(f"  ✓ {table}: marked {affected} orphan rows is_active=0")
            else:
                # Should never reach here (argparse validates choices)
                conn.rollback()
                results[table] = -1
                log(f"  ❌ {table}: unknown action '{action}'")
        except Exception as e:
            try:
                conn.rollback()
            except Exception:
                pass
            log(f"  ❌ {table}: cleanup failed — {e}")
            results[table] = -1

    return results


def print_execute_summary(
    results: Dict[str, int], action: str
) -> None:
    """Print the final cleanup summary."""
    verb_past = "deleted" if action == "delete" else "marked inactive"
    print()
    print("=" * 60)
    print("  CLEANUP COMPLETE")
    print("=" * 60)
    for table, n in results.items():
        if n < 0:
            print(f"  {table:25s}: ❌ FAILED")
        elif n == 0:
            print(f"  {table:25s}: (no orphans)")
        else:
            print(f"  {table:25s}: {verb_past} {n} rows")
    total = sum(n for n in results.values() if n > 0)
    print("-" * 60)
    print(f"  TOTAL {verb_past.upper()}: {total} rows")
    print("=" * 60)


# ---------------------------------------------------------------------------
# Main / نقطة الدخول
# ---------------------------------------------------------------------------
def parse_args(argv: Optional[List[str]] = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(
        prog="cleanup_orphans.py",
        description=(
            "Scan predictions.db + stocks.db for orphaned records and "
            "delete or mark them. Part of P14-PHASE-B-INTEGRITY (DATA-02 + "
            "DATA-05 remediation). DEFAULT is dry-run (no changes)."
        ),
        epilog=(
            "Examples:\n"
            "  python3 scripts/cleanup_orphans.py\n"
            "  python3 scripts/cleanup_orphans.py --execute --action delete\n"
            "  python3 scripts/cleanup_orphans.py --execute --action mark\n"
        ),
        formatter_class=argparse.RawDescriptionHelpFormatter,
    )
    mode = parser.add_mutually_exclusive_group()
    mode.add_argument(
        "--dry-run",
        action="store_true",
        default=True,
        help="Scan + print report only. No modifications. (DEFAULT)",
    )
    mode.add_argument(
        "--execute",
        dest="execute",
        action="store_true",
        default=False,
        help="Actually perform the cleanup (DELETE or UPDATE).",
    )
    parser.add_argument(
        "--action",
        choices=["delete", "mark"],
        default="delete",
        help=(
            "Cleanup action when --execute is passed. "
            "'delete' (default) = DELETE orphan rows. "
            "'mark' = add is_active column if missing + SET is_active=0."
        ),
    )
    parser.add_argument(
        "--db-dir",
        type=Path,
        default=DEFAULT_DB_DIR,
        help=f"Directory containing stocks.db + predictions.db "
             f"(default: {DEFAULT_DB_DIR}).",
    )
    return parser.parse_args(argv)


def main(argv: Optional[List[str]] = None) -> int:
    args = parse_args(argv)
    db_dir: Path = args.db_dir.resolve()
    stocks_db: Path = db_dir / STOCKS_DB_FILENAME
    predictions_db: Path = db_dir / PREDICTIONS_DB_FILENAME

    # --- Validate DB files exist ---
    if not stocks_db.exists():
        print(f"❌ ERROR: stocks.db not found at {stocks_db}", file=sys.stderr)
        return 1
    if not predictions_db.exists():
        print(
            f"❌ ERROR: predictions.db not found at {predictions_db}",
            file=sys.stderr,
        )
        return 1
    if not stocks_db.is_file() or not predictions_db.is_file():
        print("❌ ERROR: DB paths are not regular files.", file=sys.stderr)
        return 1

    log(f"DB dir: {db_dir}")
    log(f"stocks.db: {stocks_db}")
    log(f"predictions.db: {predictions_db}")

    mode = "EXECUTE" if args.execute else "DRY-RUN"
    log(f"Mode: {mode}" + (f", action={args.action}" if args.execute else ""))

    # --- Open connection (read-only for dry-run) ---
    writable = bool(args.execute)
    conn: Optional[sqlite3.Connection] = None
    try:
        conn = open_predictions_conn(predictions_db, stocks_db, writable=writable)

        # 1. SCAN — always done first (even in execute mode, the report is printed).
        log("Scanning for orphans...")
        reports = scan_all(conn)

        # 2. REPORT — always printed
        total_orphans = print_report(
            reports, mode, args.action, predictions_db, stocks_db
        )

        # 3. EXECUTE — only if --execute
        if not args.execute:
            log("Dry-run complete — no changes made. Re-run with --execute to clean up.")
            return 0

        if total_orphans == 0:
            log("No orphans found — nothing to clean up.")
            return 0

        print()
        print(f"EXECUTING CLEANUP (--action={args.action})...")
        log(f"Executing cleanup: action={args.action}")
        results = execute_cleanup(conn, reports, args.action)
        print_execute_summary(results, args.action)
        log("Cleanup complete.")
        return 0

    except sqlite3.Error as e:
        print(f"❌ SQLite error: {e}", file=sys.stderr)
        log(f"SQLite error: {e}")
        return 1
    except Exception as e:
        print(f"❌ Unexpected error: {e}", file=sys.stderr)
        log(f"Unexpected error: {e}")
        return 1
    finally:
        if conn is not None:
            try:
                # Detach first to be polite (optional).
                conn.execute("DETACH DATABASE stocks_db")
            except Exception:
                pass
            try:
                conn.close()
            except Exception:
                pass
            log("Connection closed.")


if __name__ == "__main__":
    sys.exit(main())
