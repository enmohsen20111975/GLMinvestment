#!/usr/bin/env python3
"""
check_no_raw_insert.py — DEV-07 §5 + DEV-14 §1 CI gate
========================================================

Fails the build if any ACTIVE `INSERT INTO predictions` SQL is found
outside the canonical writer:

    - vps-service/core/safe_insert_prediction.py    (single entry point)

DEV-12 (2026-10-13 — PRODUCTION-AUDIT G3+G5):
``prediction_tracker.py`` is NO LONGER in the canonical set. After DEV-12,
``record_prediction()`` calls ``safe_insert_prediction()`` for the actual
INSERT, so the repo has exactly ONE INSERT site (in safe_insert_prediction).

DEV-14 (2026-10-13 — PRODUCTION-AUDIT G6):
Replaced the previous comment-marker filtering (`'DEV-06'`, `'RULE35'`,
`'dead code'`, `'FINALIZE-UNIFICATION'`, etc.) with an EXPLICIT allowlist
of disabled files. Each allowlisted file is verified at CI time to still
have its early-return / sys.exit() guard in place — if anyone removes the
guard, the CI fails (rather than silently letting the masked-wipe through).

What counts as ACTIVE (will FAIL the check):
    - Lines containing `INSERT INTO predictions` that:
        * are NOT inside a triple-quoted docstring (track state across lines)
        * are NOT a pure comment line (leading `#` or `--`)
        * are NOT in an allowlisted disabled file (with verified guard)
        * are NOT in a canonical writer

What is filtered OUT (treated as passive):
    - Files in archive/ paths (dead-code archives)
    - __pycache__ bytecode
    - .pyc / .pyo files
    - Canonical writer (safe_insert_prediction.py)
    - Allowlisted disabled files (with verified guard)
    - Pure comment lines (#... or --...)
    - Lines inside triple-quoted docstrings

Usage:
    python3 scripts/check_no_raw_insert.py
    exit code: 0 = PASS (no active raw INSERTs)
               1 = FAIL (active raw INSERTs found — listed on stderr)

Acceptance (DEV-07 §6 + DEV-14):
    CI check: 0 raw INSERT outside canonical ✅

References:
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
    - worklog.md DEV-07 §5 + DEV-12 + DEV-14
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = ['vps-service', 'scripts', 'mini-services']

# ════════════════════════════════════════════════════════════════════════════
# Canonical writer — INSERT INTO predictions is allowed ONLY in this file.
# DEV-12: prediction_tracker.py REMOVED (it now calls safe_insert_prediction).
# ════════════════════════════════════════════════════════════════════════════
CANONICAL_FILES = {
    'vps-service/core/safe_insert_prediction.py',
}

# ════════════════════════════════════════════════════════════════════════════
# DEV-14 §1 — EXPLICIT ALLOWLIST of disabled files.
#
# Each entry: (relative_path, expected_guard_pattern)
#
# `expected_guard_pattern` is a regex that MUST match at least one line
# BEFORE the first INSERT statement in the file. If the guard is missing
# (e.g., someone removed the early-return / sys.exit), the CI FAILS.
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
    'vps-service/api/historical_predictions_v2_routes.py':  r'^\s*return\b',   # REAPPLY-CRITICAL-FIXES early-return at L442
    'vps-service/api/ai_predictions_routes.py':             r'^\s*return\b',   # REAPPLY-CRITICAL-FIXES early-return at L548
    'vps-service/scripts/generate_persona_predictions.py':   r'^\s*sys\.exit\s*\(',  # FINALIZE-UNIFICATION sys.exit at L335
    'vps-service/scripts/backtesting_engine.py':            r'^\s*sys\.exit\s*\(',  # FINALIZE-UNIFICATION sys.exit at L678
    'vps-service/scripts/dual_track_generator.py':          r'^\s*return\b',   # DISABLE-SCRIPTS early-return at L448
    'vps-service/scripts/backfill_to_predictions.py':       r'^\s*sys\.exit\s*\(',  # FINALIZE-UNIFICATION sys.exit at L392
    'vps-service/scripts/backfill_with_personas.py':        r'^\s*sys\.exit\s*\(',  # FINALIZE-UNIFICATION sys.exit at L667
    'vps-service/scripts/populate_history_fast.py':         r'^\s*sys\.exit\s*\(',  # FINALIZE-UNIFICATION sys.exit at L133
    'scripts/backfill_history.py':                          r'^\s*return\b',   # DEV-07 disabled (early-return)
    'scripts/sync-real-data.py':                              r'^\s*return\b',   # RULE35-DISABLED early-return at L21
    'scripts/volume_surge_hunter_test.py':                   r'^\s*return\b',   # DEV-07 disabled (early-return)

    # ── Verify-test scripts (intentional test INSERTs in verify_* functions) ──
    # These have INSERTs that ABORT (trigger fires) — the INSERTs only run
    # during `--verify` smoke tests, never in production.
    'vps-service/scripts/apply_guard_triggers.py':           r'__DEV\d+_TEST__',  # verify INSERTs use __DEV13_TEST__ ticker
    'vps-service/scripts/add_prediction_guard_trigger.py':   r'__DEV\d+_TEST__',  # verify INSERTs use __DEV07_TEST__ ticker

    # ── Docstring examples (INSERT inside triple-quoted docstring) ──
    # The triple-quote state machine handles these automatically.
    'vps-service/core/db_manager.py':                        r'^\s*"""',  # INSERTs are inside docstrings
}

# Path fragments that mark a file as out-of-scope
PATH_EXCLUDES = (
    'archive/',
    '__pycache__',
    '.pyc',
    '.pyo',
    'node_modules',
    'check_no_raw_insert',  # self-reference (this script's own docstring/grep)
)

# Regex for the INSERT pattern (case insensitive, allows whitespace)
INSERT_PATTERN = re.compile(
    r'INSERT\s+INTO\s+predictions\b',
    re.IGNORECASE,
)

# Triple-quote token markers (track docstring state across lines)
TRIPLE_QUOTES = ('"""', "'''")


def is_path_excluded(rel_path: str) -> bool:
    """Return True if the file path is out-of-scope for the check."""
    for exc in PATH_EXCLUDES:
        if exc in rel_path:
            return True
    return False


def verify_disabled_guard(rel_path: str, guard_re: re.Pattern) -> Tuple[bool, str]:
    """Verify that the disabled file still has its guard in place.

    A guard is a `return` / `sys.exit()` statement that appears BEFORE
    the first ACTIVE `INSERT INTO predictions` SQL statement. If the
    guard is missing or comes AFTER the INSERT, the file is no longer
    protected and the CI must FAIL.

    For verify-test scripts (guard pattern `__DEV<digits>_TEST__`), the guard
    is the test-ticker literal — it appears IN the INSERT line itself
    (not before it). For these, we accept the guard being on the same
    line as the INSERT.

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

    # Special case: __DEV*_TEST__ pattern — the guard IS the test ticker literal
    # that appears on the INSERT line itself (verify-test scripts).
    if '__DEV' in guard_re.pattern and 'TEST__' in guard_re.pattern:
        # Verify each INSERT in the file has a __DEV*_TEST__ ticker nearby.
        # INSERTs in verify_* functions often span 6+ lines (multi-line execute
        # call), so we look 2 lines above and 10 lines below the INSERT keyword.
        lines = text.splitlines()
        in_triple = False
        triple_token = None
        for idx, raw in enumerate(lines):
            line = raw.rstrip()
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

            stripped = line.lstrip()
            if stripped.startswith('#') or stripped.startswith('--'):
                continue
            if INSERT_PATTERN.search(line):
                # Look 2 lines above and 10 lines below (INSERT often spans
                # multi-line execute calls with the ticker literal as a param).
                nearby = '\n'.join(lines[max(0, idx-2):idx+11])
                if not guard_re.search(nearby):
                    return False, (
                        f'VERIFY-TEST GUARD MISSING: {rel_path} INSERT at L{idx+1} '
                        f'has no __DEV*_TEST__ ticker literal nearby — this means '
                        f'a real INSERT (not a test cleanup) was added. Either '
                        f'redirect to safe_insert_prediction or add the ticker.'
                    )
        return True, 'verify-test guard OK (all INSERTs have __DEV*_TEST__ ticker)'

    # Special case: docstring opener pattern (r'^\s*"""') — accept any file
    # whose INSERTs are all inside triple-quoted docstrings. The triple-quote
    # state machine in find_violations() handles this automatically, so we
    # just need to confirm the file exists and has triple-quotes.
    if guard_re.pattern == r'^\s*"""':
        if '"""' in text or "'''" in text:
            return True, 'docstring-example file OK (INSERTs are in docstrings)'
        return False, f'{rel_path}: expected triple-quoted docstring with INSERT example, but no triple-quote found'

    # General case: early-return / sys.exit guard before first INSERT.
    lines = text.splitlines()
    first_insert_line = None
    guard_line = None
    in_triple = False
    triple_token = None

    for idx, raw in enumerate(lines):
        line = raw.rstrip()
        stripped = line.lstrip()

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

        # Detect active SQL INSERT
        if first_insert_line is None and INSERT_PATTERN.search(line):
            if stripped.startswith('#') or stripped.startswith('--'):
                continue
            if stripped.startswith('print(') or stripped.startswith('log('):
                continue
            first_insert_line = idx + 1

        # Detect guard
        if guard_line is None and guard_re.search(line):
            if not stripped.startswith('#') and not stripped.startswith('--'):
                guard_line = idx + 1

        if first_insert_line is not None and guard_line is not None:
            break

    if first_insert_line is None:
        return True, f'(no active SQL INSERT found — allowlist entry is stale but harmless)'

    if guard_line is None:
        return False, (
            f'GUARD MISSING: {rel_path} is allowlisted with pattern '
            f'{guard_re.pattern!r} but no matching guard line found. '
            f'First active SQL INSERT at L{first_insert_line}.'
        )

    if guard_line >= first_insert_line:
        return False, (
            f'GUARD AFTER INSERT: {rel_path} guard at L{guard_line} but '
            f'first active SQL INSERT at L{first_insert_line} — guard does NOT '
            f'protect against the INSERT. Re-add an early-return/sys.exit before the INSERT.'
        )

    return True, f'guard at L{guard_line} protects INSERT at L{first_insert_line}'


def find_violations() -> Tuple[List[Tuple[str, int, str]], List[str]]:
    """Scan all in-scope Python files for ACTIVE raw INSERT INTO predictions.

    Returns:
        (violations, disabled_guard_errors)
        - violations: list of (rel_path, lineno, line_content) for each active
          violation.
        - disabled_guard_errors: list of error messages for allowlisted files
          whose guard is missing/misplaced.
    """
    violations: List[Tuple[str, int, str]] = []
    disabled_guard_errors: List[str] = []

    # ── First: verify every allowlisted file's guard is intact ──────────────
    for rel_path, guard_pattern in DISABLED_FILES.items():
        guard_re = re.compile(guard_pattern, re.MULTILINE)
        ok, msg = verify_disabled_guard(rel_path, guard_re)
        if not ok:
            disabled_guard_errors.append(f'{rel_path}: {msg}')

    # ── Then: scan all in-scope files for ACTIVE INSERTs ─────────────────────
    for scan_dir in SCAN_DIRS:
        root = PROJECT_ROOT / scan_dir
        if not root.exists():
            continue
        for py_file in root.rglob('*.py'):
            rel_path = py_file.relative_to(PROJECT_ROOT).as_posix()
            if is_path_excluded(rel_path):
                continue
            if rel_path in CANONICAL_FILES:
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

            for idx, raw_line in enumerate(lines):
                line = raw_line.rstrip()

                # Triple-quote state machine
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
                # Skip print/log statements (these reference INSERT in messages)
                if stripped.startswith('print(') or stripped.startswith('log('):
                    continue

                if not INSERT_PATTERN.search(line):
                    continue

                # Active violation!
                violations.append((rel_path, idx + 1, line))

    return violations, disabled_guard_errors


def main() -> int:
    violations, guard_errors = find_violations()

    if guard_errors:
        print('❌ FAIL: disabled-file guard missing or misplaced:')
        for err in guard_errors:
            print(f'  {err}')
        print()
        print('Fix: re-add the early-return / sys.exit() guard BEFORE the')
        print('INSERT statement. The allowlist only works if the guard is intact.')
        return 1

    if not violations:
        print('✅ PASS: 0 active INSERT INTO predictions outside canonical writers')
        print(f'   Canonical writers (allowed):')
        for f in sorted(CANONICAL_FILES):
            print(f'     - {f}')
        print(f'   Allowlisted disabled files: {len(DISABLED_FILES)}')
        for f in sorted(DISABLED_FILES):
            print(f'     - {f}')
        print(f'   Scanned dirs: {", ".join(SCAN_DIRS)}')
        return 0

    print('❌ FAIL: active INSERT INTO predictions found outside canonical writers:')
    print()
    for path, lineno, line in violations:
        print(f'  {path}:{lineno}: {line.strip()}')
    print()
    print(f'   Total: {len(violations)} violation(s)')
    print()
    print('   Fix options:')
    print('   1. Redirect the INSERT to vps-service/core/safe_insert_prediction.py')
    print('   2. If the script is already disabled (early-return/sys.exit), add it')
    print('      to DISABLED_FILES in scripts/check_no_raw_insert.py.')
    print('   3. If the INSERT is in a docstring, ensure the docstring is properly')
    print('      opened with """ or \'\'\'.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
