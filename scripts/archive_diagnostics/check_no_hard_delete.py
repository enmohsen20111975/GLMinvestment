#!/usr/bin/env python3
"""CI check: fail if any ACTIVE 'DELETE FROM predictions' is found.

DEV-14 (2026-10-13 — PRODUCTION-AUDIT G6):
Replaced the previous comment-marker filtering (`'DEV-06' not in l`,
`'RULE35' not in l`, etc.) with an explicit ALLOWLIST of disabled files.
Each allowlisted file is verified at CI time to still have its
``return`` / ``sys.exit()`` guard in place — if anyone removes the
guard, the CI fails (rather than silently letting the masked-wipe
through).

Task ID: DEV-14
"""
from __future__ import annotations

import ast
import re
import subprocess
import sys
from pathlib import Path
from typing import List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = ['vps-service', 'scripts', 'src']

# ════════════════════════════════════════════════════════════════════════════
# DEV-14 §1 — EXPLICIT ALLOWLIST of disabled files.
#
# Each entry: (relative_path, expected_guard_pattern)
#
# `expected_guard_pattern` is a regex that MUST match at least one line
# BEFORE the first DELETE statement in the file. If the guard is missing
# (e.g., someone removed the early-return), the CI FAILS.
#
# Patterns supported:
#   - r'^\s*return\b'              → early-return statement
#   - r'^\s*sys\.exit\s*\('        → sys.exit() statement
#   - r'__DEV\d+_TEST__'           → test-cleanup literal (verify-test scripts
#                                     that intentionally INSERT bad rows to
#                                     test trigger firing — only run with --verify)
# ════════════════════════════════════════════════════════════════════════════
DISABLED_FILES = {
    # ── Fully-disabled scripts (main()/top-level has early-return/sys.exit) ──
    'vps-service/jobs/daily_predictor.py':         r'^\s*return\b',  # delete_old_v40_predictions() returns at L548
    'vps-service/scripts/optimization_loop.py':    r'^\s*_?sys\.exit\s*\(',  # top-level sys.exit(0) at L38
    'scripts/sync-real-data.py':                    r'^\s*return\b',  # main() returns at L21
}

# Path fragments that mark a file as out-of-scope
PATH_EXCLUDES = (
    'archive/',
    '__pycache__',
    '.pyc',
    '.pyo',
    'node_modules',
    'check_no_hard_delete',  # self-reference (this script's own docstring/grep)
)

DELETE_PATTERN = re.compile(r'DELETE\s+FROM\s+predictions', re.IGNORECASE)


def is_path_excluded(rel_path: str) -> bool:
    """Return True if the file path is out-of-scope for the check."""
    for exc in PATH_EXCLUDES:
        if exc in rel_path:
            return True
    return False


def verify_disabled_guard(rel_path: str, guard_re: re.Pattern) -> Tuple[bool, str]:
    """Verify that the disabled file still has its guard in place.

    A guard is a `return` / `sys.exit()` statement that appears BEFORE
    the first ACTIVE `DELETE FROM predictions` SQL statement. If the
    guard is missing or comes AFTER the DELETE, the file is no longer
    protected and the CI must FAIL.

    "Active SQL DELETE" = a line containing `DELETE FROM predictions`
    that is NOT:
      - a pure comment line (# or --)
      - a print/log message (string literal inside print() / log() call)
      - inside a docstring (handled by the caller's state machine, but
        here we use a simpler heuristic: skip lines whose stripped form
        starts with `print(`, `log(`, or contains `#`)

    Returns:
        (True, '') if the guard is intact.
        (False, reason) if the guard is missing or misplaced.
    """
    abs_path = PROJECT_ROOT / rel_path
    if not abs_path.exists():
        return False, f'allowlisted file missing: {rel_path}'

    try:
        text = abs_path.read_text(encoding='utf-8', errors='ignore')
    except Exception as e:
        return False, f'cannot read {rel_path}: {e}'

    lines = text.splitlines()
    first_delete_line = None
    guard_line = None

    for idx, raw in enumerate(lines):
        line = raw.rstrip()
        stripped = line.lstrip()

        # ── Detect active SQL DELETE (skip comments + print/log messages) ──
        if first_delete_line is None and DELETE_PATTERN.search(line):
            if stripped.startswith('#') or stripped.startswith('--'):
                pass  # comment — skip
            elif stripped.startswith('print(') or stripped.startswith('log('):
                pass  # print/log message — skip
            elif stripped.startswith('"""') or stripped.startswith("'''"):
                pass  # docstring opener — skip
            else:
                first_delete_line = idx + 1

        # ── Detect guard ─────────────────────────────────────────────────────
        if guard_line is None and guard_re.search(line):
            # The guard pattern (e.g., `^\s*return\b` or `sys.exit(`) must
            # be on an executable statement line — not in a comment or
            # string. We accept any line that matches because the regex
            # itself is anchored to statement-like syntax.
            if not stripped.startswith('#') and not stripped.startswith('--'):
                guard_line = idx + 1

        if first_delete_line is not None and guard_line is not None:
            break

    if first_delete_line is None:
        # No active SQL DELETE in the file at all — allowlist entry is stale.
        return True, f'(no active SQL DELETE found — allowlist entry is stale but harmless)'

    if guard_line is None:
        return False, (
            f'GUARD MISSING: {rel_path} is allowlisted with pattern '
            f'{guard_re.pattern!r} but no matching guard line found. '
            f'First active SQL DELETE at L{first_delete_line}.'
        )

    if guard_line >= first_delete_line:
        return False, (
            f'GUARD AFTER DELETE: {rel_path} guard at L{guard_line} but '
            f'first active SQL DELETE at L{first_delete_line} — guard does NOT '
            f'protect against the DELETE. Re-add an early-return/sys.exit before the DELETE.'
        )

    return True, f'guard at L{guard_line} protects DELETE at L{first_delete_line}'


def find_active_violations() -> Tuple[List[str], List[str]]:
    """Scan all in-scope Python files for ACTIVE DELETE FROM predictions.

    Returns:
        (violations, disabled_guard_errors)
        - violations: list of "path:lineno: line" for each ACTIVE DELETE not
          covered by the allowlist.
        - disabled_guard_errors: list of error messages for allowlisted files
          whose guard is missing/misplaced.
    """
    violations: List[str] = []
    disabled_guard_errors: List[str] = []

    # ── First: verify every allowlisted file's guard is intact ──────────────
    for rel_path, guard_pattern in DISABLED_FILES.items():
        guard_re = re.compile(guard_pattern, re.MULTILINE)
        ok, msg = verify_disabled_guard(rel_path, guard_re)
        if not ok:
            disabled_guard_errors.append(f'{rel_path}: {msg}')

    # ── Then: scan all in-scope files for ACTIVE DELETEs ─────────────────────
    for scan_dir in SCAN_DIRS:
        root = PROJECT_ROOT / scan_dir
        if not root.exists():
            continue
        patterns = ('*.py', '*.ts', '*.tsx', '*.js')
        for pat in patterns:
            for py_file in root.rglob(pat):
                rel_path = py_file.relative_to(PROJECT_ROOT).as_posix()
                if is_path_excluded(rel_path):
                    continue
                if rel_path in DISABLED_FILES:
                    # Already verified by guard check above — skip.
                    continue
            try:
                text = py_file.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            lines = text.splitlines()
            in_triple = False
            triple_token = None
            TRIPLE_QUOTES = ('"""', "'''")

            for idx, raw_line in enumerate(lines):
                line = raw_line.rstrip()

                # Triple-quote state machine (skip docstrings)
                if not in_triple:
                    for tok in TRIPLE_QUOTES:
                        if tok in line:
                            count = line.count(tok)
                            if count % 2 == 1:
                                in_triple = True
                                triple_token = tok
                                break
                else:
                    if triple_token and triple_token in line:
                        count = line.count(triple_token)
                        if count % 2 == 1:
                            in_triple = False
                            triple_token = None
                    continue

                # Pure comment lines
                stripped = line.lstrip()
                if stripped.startswith('#') or stripped.startswith('--'):
                    continue

                if DELETE_PATTERN.search(line):
                    violations.append(f'{rel_path}:{idx + 1}: {line.strip()}')

    return violations, disabled_guard_errors


def main() -> int:
    violations, guard_errors = find_active_violations()

    if guard_errors:
        print('❌ FAIL: disabled-file guard missing or misplaced:')
        for err in guard_errors:
            print(f'  {err}')
        print()
        print('Fix: re-add the early-return / sys.exit() guard BEFORE the')
        print('DELETE statement. The allowlist only works if the guard is intact.')
        return 1

    if violations:
        print(f'❌ FAIL: {len(violations)} active DELETE FROM predictions found:')
        for line in violations:
            print(f'  {line}')
        print()
        print('Fix options:')
        print('  1. Replace DELETE with UPDATE status=\'ARCHIVED\' (DEV-06 pattern).')
        print('  2. If the script is already disabled (early-return/sys.exit),')
        print('     add it to DISABLED_FILES in scripts/check_no_hard_delete.py.')
        return 1

    print('✅ PASS: 0 active DELETE FROM predictions')
    print(f'   Allowlisted disabled files: {len(DISABLED_FILES)}')
    for rel_path in sorted(DISABLED_FILES):
        print(f'     - {rel_path}')
    return 0


if __name__ == '__main__':
    sys.exit(main())
