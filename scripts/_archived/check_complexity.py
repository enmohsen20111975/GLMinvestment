#!/usr/bin/env python3
"""
check_complexity.py — CI guardrails for SIMPLIFICATION_PLAN (PHASE 7-A, v3.53.0)
=================================================================================

Prevents complexity from creeping back into the codebase. Three checks:

  1. --max-lines 600
     Fail if any NEW file (not in baseline) exceeds 600 lines.
     Existing god files (master_analyzer.py, misc_routes.py, etc.) are
     grandfathered until PHASE 3 splits them.

  2. --no-inline-sql
     Fail if any .py file OUTSIDE data/ contains inline SQL that reads/writes
     price or analysis tables directly. This is the ROOT CAUSE of the prod
     bug (analyzed:0) — trigger_analysis_manual used the wrong reader.
     Allowed tables outside data/:
       - stored_analyses (INSERT/SELECT) — ONLY in data/analyses.py
       - stock_daily_prices, price_history, stock_price_history — ONLY in data/
     The check: any FROM/INSERT/UPDATE/DELETE on these tables in a file
     whose path does NOT start with vps-service/data/ → FAIL.

  3. --no-new-god-files
     Fail if god_files_backend count exceeds baseline (from audit_map.json).
     Uses Documentation/audit_map.json if present, else skips.

Usage:
  python3 scripts/check_complexity.py                    # run all 3 checks
  python3 scripts/check_complexity.py --max-lines 600    # only file-size
  python3 scripts/check_complexity.py --no-inline-sql    # only SQL check
  python3 scripts/check_complexity.py --no-new-god-files # only god-file count
  python3 scripts/check_complexity.py --baseline scripts/complexity-baseline.json

Exit codes:
  0 — all checks passed
  1 — one or more checks failed (print violations to stderr)
  2 — script error

This script is idempotent and fast (< 5s). It does NOT modify any files.
"""
from __future__ import annotations

import argparse
import json
import os
import re
import sys
from pathlib import Path
from typing import Dict, List, Set, Tuple

ROOT = Path(__file__).resolve().parent.parent

# ─────────────────────────────────────────────────────────────────────────────
# Config
# ─────────────────────────────────────────────────────────────────────────────
PY_BACKEND_DIR = ROOT / "vps-service"
FRONTEND_DIR = ROOT / "src"
AUDIT_JSON = ROOT / "Documentation" / "audit_map.json"
DEFAULT_BASELINE = ROOT / "scripts" / "complexity-baseline.json"

# Tables that ONLY data/ may touch (root cause of prod bugs)
RESTRICTED_TABLES = {
    "stock_daily_prices",
    "price_history",
    "stock_price_history",
    "egksco_price_history",
    "stored_analyses",
}

# Files allowed to have inline SQL on restricted tables (the data layer + the
# persist function's canonical home). Everything else must use the helpers.
SQL_ALLOWLIST_PREFIXES = (
    "vps-service/data/",       # data/prices.py, data/analyses.py — THE data layer
    "vps-service/core/migrator",  # schema migrations are allowed to touch any table
    "vps-service/core/db_manager",  # DB manager utility
)

# Files exempt from the 600-line limit (data-layer consolidations, pre-existing
# god files pending PHASE 3 split). The baseline file is the source of truth;
# this is just a fallback if baseline is missing.
LINE_LIMIT_EXEMPT_HINTS = (
    "data/analyses.py",   # 817 lines — consolidates 10 functions (P4 data layer)
    "data/prices.py",     # PHASE 1 unified reader
)

# Default line limit
DEFAULT_MAX_LINES = 600


def _rel(p: Path) -> str:
    try:
        return str(p.relative_to(ROOT))
    except ValueError:
        return str(p)


# ─────────────────────────────────────────────────────────────────────────────
# Check 1: File-size limit (no NEW files > N lines)
# ─────────────────────────────────────────────────────────────────────────────
def check_max_lines(max_lines: int, baseline_path: Path) -> Tuple[bool, List[str]]:
    """Fail if any .py/.tsx/.ts file (not in baseline) exceeds max_lines."""
    violations: List[str] = []

    # Load baseline (set of file paths that were already > max_lines at snapshot)
    baseline_files: Set[str] = set()
    if baseline_path.exists():
        try:
            data = json.loads(baseline_path.read_text(encoding="utf-8"))
            baseline_files = set(data.get("large_files", []))
        except Exception as e:
            print(f"[check_complexity] WARNING: could not read baseline {baseline_path}: {e}",
                  file=sys.stderr)

    # Scan all .py files in vps-service, all .ts/.tsx in src
    candidates: List[Path] = []
    for ext in ("*.py",):
        candidates.extend(PY_BACKEND_DIR.rglob(ext))
    for ext in ("*.ts", "*.tsx"):
        candidates.extend(FRONTEND_DIR.rglob(ext))

    for fpath in candidates:
        # Skip excluded dirs
        parts = fpath.parts
        if any(x in parts for x in ("__pycache__", "node_modules", ".next", ".venv")):
            continue
        try:
            line_count = sum(1 for _ in fpath.open(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        if line_count <= max_lines:
            continue

        rel_path = _rel(fpath)
        # Exempt if in baseline (pre-existing) or in hint list
        if rel_path in baseline_files:
            continue
        if any(hint in rel_path for hint in LINE_LIMIT_EXEMPT_HINTS):
            continue

        violations.append(f"{rel_path}: {line_count} lines (limit {max_lines})")

    return (len(violations) == 0, violations)


# ─────────────────────────────────────────────────────────────────────────────
# Check 2: No inline SQL on restricted tables outside data/
# ─────────────────────────────────────────────────────────────────────────────
# Pattern: FROM <table>, INSERT INTO <table>, UPDATE <table>, DELETE FROM <table>
SQL_TABLE_PATTERN = re.compile(
    r"\b(?:FROM|INSERT\s+INTO|UPDATE|DELETE\s+FROM)\s+"
    r"(?:IF\s+NOT\s+EXISTS\s+)?"
    r"(?:`?(\w+)`?)",
    re.IGNORECASE,
)


def check_no_inline_sql(baseline_path: Path = None) -> Tuple[bool, List[str]]:
    """Fail if any file outside data/ has NEW inline SQL on restricted tables.

    "New" = the (file, table) pair is not in the baseline snapshot. This lets
    us grandfather the 386 pre-existing violations (PHASE 1-3 debt) while
    preventing any NEW file from touching restricted tables directly.
    """
    violations: List[str] = []

    # Load baseline of (file, table) pairs
    baseline_pairs: Set[str] = set()
    if baseline_path and baseline_path.exists():
        try:
            data = json.loads(baseline_path.read_text(encoding="utf-8"))
            baseline_pairs = set(data.get("inline_sql_violations", []))
        except Exception as e:
            print(f"[check_complexity] WARNING: could not read SQL baseline: {e}",
                  file=sys.stderr)

    for fpath in PY_BACKEND_DIR.rglob("*.py"):
        parts = fpath.parts
        if any(x in parts for x in ("__pycache__", ".venv", "venv")):
            continue
        rel_path = _rel(fpath)

        # Skip allowlist
        if any(rel_path.startswith(prefix) for prefix in SQL_ALLOWLIST_PREFIXES):
            continue

        try:
            src = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue

        # Find all SQL table references
        for m in SQL_TABLE_PATTERN.finditer(src):
            table = m.group(1).lower()
            if table not in RESTRICTED_TABLES:
                continue
            # Find line number
            line_no = src[:m.start()].count("\n") + 1
            pair_key = f"{rel_path}:{table}"
            if pair_key in baseline_pairs:
                continue  # grandfathered
            violations.append(
                f"{rel_path}:{line_no}: NEW inline SQL on restricted table '{table}' "
                f"(use data/prices.py or data/analyses.py instead)"
            )

    return (len(violations) == 0, violations)


def _collect_all_inline_sql_violations() -> List[str]:
    """Collect ALL current (file, table) pairs for baseline snapshotting."""
    pairs: Set[str] = set()
    for fpath in PY_BACKEND_DIR.rglob("*.py"):
        parts = fpath.parts
        if any(x in parts for x in ("__pycache__", ".venv", "venv")):
            continue
        rel_path = _rel(fpath)
        if any(rel_path.startswith(prefix) for prefix in SQL_ALLOWLIST_PREFIXES):
            continue
        try:
            src = fpath.read_text(encoding="utf-8", errors="replace")
        except Exception:
            continue
        for m in SQL_TABLE_PATTERN.finditer(src):
            table = m.group(1).lower()
            if table in RESTRICTED_TABLES:
                pairs.add(f"{rel_path}:{table}")
    return sorted(pairs)


# ─────────────────────────────────────────────────────────────────────────────
# Check 3: No new god files (god_files_backend count ≤ baseline)
# ─────────────────────────────────────────────────────────────────────────────
def check_no_new_god_files(baseline_path: Path) -> Tuple[bool, List[str]]:
    """Fail if god_files_backend count exceeds baseline."""
    violations: List[str] = []

    # Load baseline count
    baseline_count: int = 0
    if baseline_path.exists():
        try:
            data = json.loads(baseline_path.read_text(encoding="utf-8"))
            baseline_count = int(data.get("god_files_backend_baseline", 0))
        except Exception as e:
            print(f"[check_complexity] WARNING: could not read god_files baseline: {e}",
                  file=sys.stderr)

    # Load current count from audit_map.json
    if not AUDIT_JSON.exists():
        # No audit_map.json — skip (can't check)
        return (True, ["(skipped: audit_map.json not found — run scripts/audit_map.py first)"])

    try:
        audit = json.loads(AUDIT_JSON.read_text(encoding="utf-8"))
        metrics = audit.get("metrics", {})
        # Key is "god_files_backend (>=400 lines)" in audit_map.json
        current_count = int(metrics.get("god_files_backend (>=400 lines)",
                                        metrics.get("god_files_backend", 0)))
    except Exception as e:
        return (False, [f"could not read audit_map.json: {e}"])

    if baseline_count == 0:
        # No baseline set — first run, just record
        return (True, [f"(first run: current god_files_backend={current_count}, baseline not set)"])

    if current_count > baseline_count:
        violations.append(
            f"god_files_backend increased: {baseline_count} → {current_count} "
            f"(baseline={baseline_count}). New god files must be split (PHASE 3) "
            f"or added to scripts/complexity-baseline.json if data-layer consolidation."
        )

    return (len(violations) == 0, violations)


# ─────────────────────────────────────────────────────────────────────────────
# Baseline management
# ─────────────────────────────────────────────────────────────────────────────
def write_baseline(baseline_path: Path) -> None:
    """Snapshot current state as the baseline."""
    # Snapshot all files > 600 lines
    large_files: List[str] = []
    for fpath in PY_BACKEND_DIR.rglob("*.py"):
        parts = fpath.parts
        if any(x in parts for x in ("__pycache__", ".venv", "venv")):
            continue
        try:
            line_count = sum(1 for _ in fpath.open(encoding="utf-8", errors="replace"))
        except Exception:
            continue
        if line_count > DEFAULT_MAX_LINES:
            large_files.append(_rel(fpath))
    for ext in ("*.ts", "*.tsx"):
        for fpath in FRONTEND_DIR.rglob(ext):
            parts = fpath.parts
            if any(x in parts for x in ("node_modules", ".next")):
                continue
            try:
                line_count = sum(1 for _ in fpath.open(encoding="utf-8", errors="replace"))
            except Exception:
                continue
            if line_count > DEFAULT_MAX_LINES:
                large_files.append(_rel(fpath))

    # Snapshot god_files_backend count
    god_count = 0
    if AUDIT_JSON.exists():
        try:
            audit = json.loads(AUDIT_JSON.read_text(encoding="utf-8"))
            metrics = audit.get("metrics", {})
            god_count = int(metrics.get("god_files_backend (>=400 lines)",
                                        metrics.get("god_files_backend", 0)))
        except Exception:
            pass

    baseline = {
        "max_lines": DEFAULT_MAX_LINES,
        "large_files": sorted(large_files),
        "god_files_backend_baseline": god_count,
        "inline_sql_violations": _collect_all_inline_sql_violations(),
        "note": "Snapshot of files > 600 lines + god_files_backend count + "
                "inline SQL (file:table) pairs. Regenerate with --write-baseline "
                "after intentional additions.",
    }
    baseline_path.write_text(json.dumps(baseline, indent=2, ensure_ascii=False), encoding="utf-8")
    print(f"[check_complexity] wrote baseline: {baseline_path}", file=sys.stderr)
    print(f"  large_files (> {DEFAULT_MAX_LINES} lines): {len(large_files)}", file=sys.stderr)
    print(f"  god_files_backend baseline: {god_count}", file=sys.stderr)
    print(f"  inline_sql_violations: {len(baseline['inline_sql_violations'])} (file:table pairs)", file=sys.stderr)


# ─────────────────────────────────────────────────────────────────────────────
# Main
# ─────────────────────────────────────────────────────────────────────────────
def main() -> int:
    parser = argparse.ArgumentParser(description="CI guardrails for SIMPLIFICATION_PLAN")
    parser.add_argument("--max-lines", type=int, default=DEFAULT_MAX_LINES,
                        help=f"line limit (default {DEFAULT_MAX_LINES})")
    parser.add_argument("--no-inline-sql", action="store_true",
                        help="check for inline SQL on restricted tables outside data/")
    parser.add_argument("--no-new-god-files", action="store_true",
                        help="check god_files_backend count ≤ baseline")
    parser.add_argument("--baseline", type=Path, default=DEFAULT_BASELINE,
                        help="baseline JSON file path")
    parser.add_argument("--write-baseline", action="store_true",
                        help="write current state as baseline (then exit)")
    parser.add_argument("--all", action="store_true",
                        help="run all checks (default if no flags given)")
    args = parser.parse_args()

    if args.write_baseline:
        write_baseline(args.baseline)
        return 0

    run_all = args.all or (not args.no_inline_sql and not args.no_new_god_files)
    run_size = run_all or True  # always check size unless explicitly disabled?
    # Actually: if --no-inline-sql is the only flag, skip size check
    only_sql = args.no_inline_sql and not args.no_new_god_files and not args.all
    only_god = args.no_new_god_files and not args.no_inline_sql and not args.all

    all_passed = True
    all_violations: List[str] = []

    # Check 1: file size
    if not only_sql and not only_god:
        ok, vios = check_max_lines(args.max_lines, args.baseline)
        if not ok:
            all_passed = False
            all_violations.append("─" * 60)
            all_violations.append(f"FAIL: --max-lines {args.max_lines} (new files exceeding limit)")
            all_violations.append("─" * 60)
            all_violations.extend(f"  • {v}" for v in vios)
        else:
            print(f"✅ --max-lines {args.max_lines}: passed", file=sys.stderr)

    # Check 2: inline SQL
    if args.no_inline_sql or run_all:
        ok, vios = check_no_inline_sql(args.baseline)
        if not ok:
            all_passed = False
            all_violations.append("─" * 60)
            all_violations.append("FAIL: --no-inline-sql (NEW restricted-table SQL outside data/)")
            all_violations.append("─" * 60)
            all_violations.extend(f"  • {v}" for v in vios)
        else:
            print("✅ --no-inline-sql: passed (no NEW violations)", file=sys.stderr)

    # Check 3: god files
    if args.no_new_god_files or run_all:
        ok, vios = check_no_new_god_files(args.baseline)
        if not ok:
            all_passed = False
            all_violations.append("─" * 60)
            all_violations.append("FAIL: --no-new-god-files (god_files_backend increased)")
            all_violations.append("─" * 60)
            all_violations.extend(f"  • {v}" for v in vios)
        else:
            for v in vios:
                print(f"ℹ️  --no-new-god-files: {v}", file=sys.stderr)

    if not all_passed:
        print("\n❌ Complexity check FAILED:", file=sys.stderr)
        for line in all_violations:
            print(line, file=sys.stderr)
        print("\nTo fix:", file=sys.stderr)
        print("  1. Split the offending file (PHASE 3)", file=sys.stderr)
        print("  2. OR add it to scripts/complexity-baseline.json if it's a data-layer consolidation", file=sys.stderr)
        print("  3. OR replace inline SQL with calls to data/prices.py or data/analyses.py", file=sys.stderr)
        return 1

    print("\n✅ All complexity checks passed.", file=sys.stderr)
    return 0


if __name__ == "__main__":
    sys.exit(main())
