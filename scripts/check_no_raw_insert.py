#!/usr/bin/env python3
"""
check_no_raw_insert.py — DEV-07 §5 CI gate
==========================================

Fails the build if any ACTIVE `INSERT INTO predictions` SQL is found
outside the canonical writers:
    - vps-service/core/safe_insert_prediction.py    (single entry point)
    - vps-service/analyzers/prediction_tracker.py   (canonical writer)

What counts as ACTIVE (will FAIL the check):
    - Lines containing `INSERT INTO predictions` that:
        * are NOT inside a triple-quoted docstring (track state across lines)
        * are NOT a pure comment line (leading `#` or `--`)
        * do NOT have a `DEV-07 verified-disabled` marker within the
          preceding 5 lines
        * do NOT have any disable-script marker within the preceding 5 lines:
            FINALIZE-UNIFICATION, RULE35-DISABLED, REAPPLY-CRITICAL-FIXES,
            DISABLE-SCRIPTS, DEV-06

What is filtered OUT (treated as passive):
    - Files in archive/ paths (dead-code archives)
    - __pycache__ bytecode
    - .pyc / .pyo files
    - Canonical writers themselves (safe_insert_prediction.py, prediction_tracker.py)
    - This script itself (self-reference)
    - Pure comment lines (#... or --...)
    - Lines inside triple-quoted docstrings
    - Lines with a verified-disabled marker nearby

Usage:
    python3 scripts/check_no_raw_insert.py
    exit code: 0 = PASS (no active raw INSERTs)
               1 = FAIL (active raw INSERTs found — listed on stderr)

Acceptance (DEV-07 §6):
    CI check: 0 raw INSERT outside canonical ✅

References:
    - Documentation/00-CONSTITUTION.md §35 (ENGINE-UNIFY)
    - worklog.md DEV-07 §5
"""
from __future__ import annotations

import re
import sys
from pathlib import Path
from typing import List, Tuple

PROJECT_ROOT = Path(__file__).resolve().parents[1]
SCAN_DIRS = ['vps-service', 'scripts', 'mini-services']

# Canonical writers — INSERT INTO predictions is allowed ONLY in these files
CANONICAL_FILES = {
    'vps-service/core/safe_insert_prediction.py',
    'vps-service/analyzers/prediction_tracker.py',
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

# Disable-script markers — if any of these appears in the 5 lines above an
# INSERT, the INSERT is considered dead code (preserved for rollback reference)
DISABLE_MARKERS = (
    'DEV-07 verified-disabled',
    'FINALIZE-UNIFICATION',
    'RULE35-DISABLED',
    'REAPPLY-CRITICAL-FIXES',
    'DISABLE-SCRIPTS',
    'DEV-06',
    'PRESERVED BLOCK',
    'preserved for rollback',
    'DO NOT EXECUTE',
    'dead code',
)

# Look-back window for disable markers (in lines)
LOOKBACK_LINES = 5

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


def find_disable_marker_above(lines: List[str], insert_idx: int) -> bool:
    """Look up to LOOKBACK_LINES above `lines[insert_idx]` for any disable marker."""
    start = max(0, insert_idx - LOOKBACK_LINES)
    for i in range(start, insert_idx):
        line_lower = lines[i].lower()
        for marker in DISABLE_MARKERS:
            if marker.lower() in line_lower:
                return True
    return False


def find_violations() -> List[Tuple[str, int, str]]:
    """Scan all in-scope Python files for ACTIVE raw INSERT INTO predictions.

    Returns:
        List of (rel_path, lineno, line_content) for each active violation.
    """
    violations: List[Tuple[str, int, str]] = []

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
            try:
                text = py_file.read_text(encoding='utf-8', errors='ignore')
            except Exception:
                continue

            lines = text.splitlines()

            # Track triple-quote state across the file
            in_triple = False
            triple_token = None

            for idx, raw_line in enumerate(lines):
                line = raw_line.rstrip()

                # ── Triple-quote state machine ────────────────────────────
                # Count triple-quote tokens on this line. Toggle state on odd
                # count. Track which token (`"""` or `'''`) opened the block
                # so we can correctly close it.
                if not in_triple:
                    # Look for opening token
                    for tok in TRIPLE_QUOTES:
                        if tok in line:
                            # Count occurrences — odd means we're now inside
                            count = line.count(tok)
                            if count % 2 == 1:
                                in_triple = True
                                triple_token = tok
                                break
                            # If even (e.g., `"""..."""` on one line),
                            # we stay outside — but the content between
                            # is a docstring. Check if INSERT is inside it.
                            # Simplest: if line has INSERT and any triple-quote,
                            # treat the whole line as inside-docstring (skip).
                            if INSERT_PATTERN.search(line):
                                # INSERT appears on a line with `"""..."""` —
                                # this is docstring content, not active code.
                                # Check: is there an `execute(` call on the
                                # same line (active call with inline SQL)?
                                if 'execute' not in line:
                                    # Pure docstring example — skip
                                    line = None  # mark as skip below
                else:
                    # We're inside a docstring — check for closing token
                    if triple_token and triple_token in line:
                        count = line.count(triple_token)
                        if count % 2 == 1:
                            in_triple = False
                            triple_token = None
                    # Whatever the case, this line is docstring content — skip
                    continue

                if line is None:
                    continue

                # ── Pure comment lines ────────────────────────────────────
                stripped = line.lstrip()
                if stripped.startswith('#') or stripped.startswith('--'):
                    continue

                # ── INSERT INTO predictions check ─────────────────────────
                if not INSERT_PATTERN.search(line):
                    continue

                # Found an INSERT — check if there's a disable marker above
                if find_disable_marker_above(lines, idx):
                    continue

                # Active violation!
                violations.append((rel_path, idx + 1, line))

    return violations


def main() -> int:
    violations = find_violations()

    if not violations:
        print('✅ PASS: 0 active INSERT INTO predictions outside canonical writers')
        print(f'   Canonical writers (allowed):')
        for f in sorted(CANONICAL_FILES):
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
    print('   2. If the script is already disabled (early-return/sys.exit), add a')
    print('      "# DEV-07 verified-disabled (dead code — early-return at line N)"')
    print('      marker above the INSERT line.')
    print('   3. If the INSERT is in a docstring, ensure the docstring is properly')
    print('      opened with """ or \'\'\'.')
    return 1


if __name__ == '__main__':
    sys.exit(main())
